import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStripeTestConfig, StripeFoundationError, assertStripeTestLivemode } from "./stripe-config.ts";
import { getStripeClient } from "./stripe-client.ts";
import { resolveCanonicalPackageStripePriceId } from "./stripe-component-price-resolver.ts";
import { createStripeCheckoutAttempt } from "./stripe-checkout-attempts.ts";
import { buildSafeStripeMetadata, rejectUnsafeStripeMetadataKeys } from "./stripe-catalog.ts";
import { isPlanKey, type PlanKey } from "../catalog.ts";
import { isStripeTestFoundationReady, getStripeTestReadiness } from "./stripe-readiness.ts";
import { upsertStripeSubscriptionProjection } from "./stripe-subscription-projection.ts";
import {
  collectStripePlanChangeFinancialActual,
  stripeCreditSnapshotMatchesQuote,
} from "./stripe-plan-change-financial-actual.ts";

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

async function resolveClientStripeSubscription(
  supabase: SupabaseClient,
  input: { clientId: string; accountId: string; entitlementId: string },
) {
  const { data: subscriptionRows, error } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("stripe_subscription_id,stripe_customer_id,account_id,client_account_entitlement_id,status,livemode,commercial_checkout_session_id,commercial_mode,pricing_mode,pricing_snapshot_fingerprint")
    .eq("client_id", input.clientId)
    .eq("account_id", input.accountId)
    .eq("client_account_entitlement_id", input.entitlementId)
    .in("status", ["active", "trialing"])
    .eq("livemode", false)
    .order("updated_at", { ascending: false })
    .limit(2);

  if (error || !Array.isArray(subscriptionRows) || subscriptionRows.length !== 1) return null;
  const subscriptionRow = subscriptionRows[0] as Row;

  const stripeSubscriptionId = readString(subscriptionRow?.stripe_subscription_id);
  if (!stripeSubscriptionId) return null;
  return {
    stripeSubscriptionId,
    stripeCustomerId: readString(subscriptionRow?.stripe_customer_id),
    row: subscriptionRow as Row,
  };
}

export async function createStripePlanChangePaymentSession(
  supabase: SupabaseClient,
  input: {
    quoteId: string;
    clientId: string;
    purchaserEmail: string;
    idempotencyKey: string;
    successUrl: string;
    cancelUrl: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  try {
    requireStripeTestConfig(env);
  } catch (error) {
    const code = error instanceof StripeFoundationError ? error.code : "stripe_test_not_configured";
    return { ok: false as const, status: 503, code, messageEn: "Stripe Test checkout is not configured." };
  }

  const readiness = await getStripeTestReadiness(supabase, env);
  if (!isStripeTestFoundationReady(readiness)) {
    return { ok: false as const, status: 503, code: "stripe_test_not_configured", messageEn: "Stripe Test foundation is incomplete." };
  }

  const { data: quote, error } = await supabase
    .from("commercial_plan_change_quotes")
    .select("*")
    .eq("id", input.quoteId)
    .eq("client_id", input.clientId)
    .maybeSingle<Row>();

  if (error || !quote?.id) {
    return { ok: false as const, status: 404, code: "quote_not_found", messageEn: "Quote not found." };
  }

  const amountDueCents = Number(quote.amount_due_cents ?? 0);

  if (readString(quote.status) !== "quote_pending") {
    return { ok: false as const, status: 409, code: "quote_not_pending", messageEn: "Quote is no longer pending." };
  }

  const targetPlanKey = readString(quote.target_plan_key);
  if (!isPlanKey(targetPlanKey)) {
    return { ok: false as const, status: 400, code: "invalid_plan", messageEn: "Invalid target plan." };
  }
  if (readString(quote.change_scope) !== "per_account") {
    return { ok: false as const, status: 400, code: "per_account_scope_required", messageEn: "Plan change must target one account." };
  }
  const accountId = readString(quote.account_id);
  const sourceEntitlementId = readString(quote.source_entitlement_id);
  if (!accountId || !sourceEntitlementId) {
    return { ok: false as const, status: 400, code: "entitlement_account_binding_required", messageEn: "Plan change must target one entitlement and account." };
  }
  const billingIntervalMonths = Number(quote.billing_interval_months ?? 1) as 1 | 3 | 6 | 12;
  const subscriptionBinding = await resolveClientStripeSubscription(supabase, {
    clientId: input.clientId,
    accountId,
    entitlementId: sourceEntitlementId,
  });
  if (!subscriptionBinding) {
    return {
      ok: false as const,
      status: 503,
      code: "stripe_subscription_missing",
      messageEn: "Stripe subscription is required before plan change checkout.",
    };
  }
  const { stripeSubscriptionId, stripeCustomerId } = subscriptionBinding;

  const targetPriceId = await resolveCanonicalPackageStripePriceId(supabase, {
    environment: "test",
    planKey: targetPlanKey as PlanKey,
    billingIntervalMonths,
  });
  if (!targetPriceId) {
    return {
      ok: false as const,
      status: 503,
      code: "stripe_price_mapping_missing",
      messageEn: "Stripe test price mapping is missing for the target plan.",
    };
  }
  const quoteBoundTargetPriceId = readString((quote.metadata as Row | null)?.canonical_target_stripe_price_id);
  if (quoteBoundTargetPriceId && quoteBoundTargetPriceId !== targetPriceId) {
    return {
      ok: false as const,
      status: 409,
      code: "stripe_price_mapping_changed",
      messageEn: "Stripe test price mapping changed after this quote was created.",
    };
  }

  const metadata = buildSafeStripeMetadata({
    internal_attempt_id: input.idempotencyKey,
    quote_id: input.quoteId,
    source_revision: readString(quote.source_revision),
    flow_type: "plan_change",
    account_id: accountId,
    entitlement_id: sourceEntitlementId,
    change_scope: readString(quote.change_scope) || undefined,
  });
  rejectUnsafeStripeMetadataKeys(metadata);

  const stripe = getStripeClient(env);
  if (!stripeCustomerId) {
    return {
      ok: false as const,
      status: 503,
      code: "stripe_customer_missing",
      messageEn: "Stripe customer binding is required before plan change confirmation.",
    };
  }
  const currentCreditSnapshot = await collectStripePlanChangeFinancialActual(stripe, {
    stripeSubscriptionId,
    stripeCustomerId,
    mutationUnix: Math.floor(Date.now() / 1000),
    snapshotMode: "current_credit",
  });
  const quotedStripeCreditCents = Number(quote.existing_customer_credit_cents ?? 0);
  if (
    !currentCreditSnapshot
    || !stripeCreditSnapshotMatchesQuote(quotedStripeCreditCents, currentCreditSnapshot)
  ) {
    await supabase
      .from("commercial_plan_change_quotes")
      .update({
        status: "quote_stale",
        metadata: {
          ...((quote.metadata && typeof quote.metadata === "object") ? quote.metadata as Row : {}),
          stripe_credit_validation: "changed_before_confirmation",
          canonical_stripe_credit_cents: currentCreditSnapshot?.remainingCreditCents ?? null,
          canonical_stripe_credit_source: currentCreditSnapshot?.source ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.quoteId);
    return {
      ok: false as const,
      status: 409,
      code: "stripe_credit_changed",
      messageEn: "Stripe credit changed after this quote was created.",
    };
  }
  await supabase
    .from("commercial_stripe_subscriptions")
    .update({
      plan_change_quote_id: input.quoteId,
      metadata_safe: {
        plan_change_state: "stripe_mutation_pending",
        target_stripe_price_id: targetPriceId,
        source_entitlement_id: sourceEntitlementId,
        canonical_stripe_credit_cents: currentCreditSnapshot.remainingCreditCents,
        canonical_stripe_credit_source: currentCreditSnapshot.source,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .eq("client_id", input.clientId)
    .eq("account_id", accountId);

  if (amountDueCents <= 0) {
    const customerBefore = stripeCustomerId ? await stripe.customers.retrieve(stripeCustomerId) : null;
    const customerBalanceBeforeCents = customerBefore && !customerBefore.deleted ? customerBefore.balance : null;
    const { error: baselineError } = await supabase
      .from("commercial_plan_change_quotes")
      .update({
        metadata: {
          ...((quote.metadata && typeof quote.metadata === "object") ? quote.metadata as Row : {}),
          quote_is_estimate: true,
          stripe_customer_balance_before_cents: customerBalanceBeforeCents,
          canonical_stripe_credit_cents: currentCreditSnapshot.remainingCreditCents,
          canonical_stripe_credit_source: currentCreditSnapshot.source,
          canonical_stripe_credit_object_ids: currentCreditSnapshot.sourceObjectIds,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.quoteId);
    if (baselineError) {
      return {
        ok: false as const,
        status: 503,
        code: "stripe_financial_baseline_unavailable",
        messageEn: "Could not bind the Stripe financial baseline.",
      };
    }
    const sync = await syncStripeSubscriptionPriceAfterPlanChangePayment(stripe, {
      stripeSubscriptionId,
      targetPriceId,
      settlementMode: "stripe_credit_or_zero",
      idempotencyKey: `${input.idempotencyKey}:subscription-price`,
    });
    if (!sync.ok) {
      return { ok: false as const, status: 503, code: sync.code, messageEn: "Stripe subscription price update failed." };
    }
    return {
      ok: true as const,
      checkoutUrl: null,
      internalAttemptId: null,
      targetPriceId,
      amountDueCents,
      stripeMutationInitiated: true as const,
      awaitingSubscriptionWebhook: true as const,
      prorationBehavior: sync.prorationBehavior,
    };
  }

  const stripeSession = await stripe.checkout.sessions.create({
    mode: "payment",
    ...(stripeCustomerId ? { customer: stripeCustomerId } : { customer_email: input.purchaserEmail }),
    client_reference_id: input.quoteId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        unit_amount: amountDueCents,
        product_data: {
          name: `Plan change to ${targetPlanKey}`,
        },
      },
    }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata,
  });

  if (!stripeSession.id || !stripeSession.url) {
    return { ok: false as const, status: 503, code: "stripe_session_create_failed", messageEn: "Stripe checkout session could not be created." };
  }

  const attempt = await createStripeCheckoutAttempt(supabase, {
    planChangeQuoteId: input.quoteId,
    idempotencyKey: input.idempotencyKey,
    flowType: "plan_change",
    stripeCheckoutSessionId: stripeSession.id,
    checkoutMode: "payment",
    commercialTestMode: "stripe_test",
    purchaserEmail: input.purchaserEmail,
    clientId: input.clientId,
    stripeSubscriptionId,
    targetStripePriceId: targetPriceId,
    clientAccountEntitlementId: sourceEntitlementId,
    accountId,
    commercialMode: "full_cycle",
    pricingSnapshotFingerprint: readString((quote.pricing_snapshot as Row | null)?.version),
    metadataSafe: metadata,
  });
  if (!attempt.ok) {
    return { ok: false as const, status: 503, code: attempt.code, messageEn: "Could not record Stripe checkout attempt." };
  }

  return {
    ok: true as const,
    checkoutUrl: stripeSession.url,
    internalAttemptId: attempt.attemptId,
    targetPriceId,
    amountDueCents,
  };
}

export async function syncStripeSubscriptionPriceAfterPlanChangePayment(
  stripe: Stripe,
  input: {
    stripeSubscriptionId: string;
    targetPriceId: string;
    preservePeriodEndUnix?: number | null;
    settlementMode?: "already_collected" | "stripe_credit_or_zero";
    idempotencyKey?: string | null;
  },
) {
  const subscription = await stripe.subscriptions.retrieve(input.stripeSubscriptionId);
  assertStripeTestLivemode(subscription.livemode);

  const itemId = subscription.items.data[0]?.id;
  if (!itemId) {
    return { ok: false as const, code: "stripe_subscription_item_missing" as const };
  }

  const updateParams: Stripe.SubscriptionUpdateParams = {
    items: [{ id: itemId, price: input.targetPriceId }],
    proration_behavior: input.settlementMode === "stripe_credit_or_zero" ? "create_prorations" : "none",
    billing_cycle_anchor: "unchanged",
  };

  if (input.preservePeriodEndUnix) {
    updateParams.cancel_at = undefined;
  }

  const updated = await stripe.subscriptions.update(
    input.stripeSubscriptionId,
    updateParams,
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
  );
  const appliedPriceId = updated.items.data[0]?.price?.id ?? null;
  if (appliedPriceId !== input.targetPriceId) {
    return { ok: false as const, code: "stripe_subscription_price_not_applied" as const };
  }
  return {
    ok: true as const,
    stripeSubscriptionId: updated.id,
    stripeSubscriptionItemId: updated.items.data[0]?.id ?? itemId,
    appliedPriceId,
    prorationBehavior: updateParams.proration_behavior,
  };
}

export async function reconcileStripePlanChangeFromCanonicalSubscription(
  supabase: SupabaseClient,
  input: {
    subscription: Stripe.Subscription;
    stripeEventId: string;
    stripeEventCreatedAt?: number | null;
    stripe?: Stripe;
  },
) {
  assertStripeTestLivemode(input.subscription.livemode);
  if (input.subscription.pending_update) {
    return { ok: true as const, action: "awaiting_pending_update" as const };
  }
  const currentPriceId = input.subscription.items.data[0]?.price?.id ?? null;
  if (!currentPriceId) {
    return { ok: false as const, code: "stripe_subscription_price_missing" as const };
  }

  const { data: projection } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("client_id,account_id,client_account_entitlement_id,plan_change_quote_id,stripe_customer_id,commercial_checkout_session_id,commercial_mode,pricing_mode,pricing_snapshot_fingerprint")
    .eq("stripe_subscription_id", input.subscription.id)
    .maybeSingle<Row>();
  const quoteId = readString(projection?.plan_change_quote_id);
  if (!quoteId) return { ok: true as const, action: "no_plan_change" as const };

  const { data: quote } = await supabase
    .from("commercial_plan_change_quotes")
    .select("id,client_id,account_id,target_plan_key,billing_interval_months,target_outreach_addon_key,idempotency_key,status,amount_due_cents,existing_customer_credit_cents,remaining_credit_cents,activated_checkout_session_id,metadata")
    .eq("id", quoteId)
    .maybeSingle<Row>();
  if (!quote?.id) return { ok: false as const, code: "plan_change_quote_missing" as const };

  const targetPlanKey = readString(quote.target_plan_key);
  if (!isPlanKey(targetPlanKey)) return { ok: false as const, code: "invalid_plan" as const };
  const expectedPriceId = await resolveCanonicalPackageStripePriceId(supabase, {
    environment: "test",
    planKey: targetPlanKey,
    billingIntervalMonths: Number(quote.billing_interval_months ?? 1) as 1 | 3 | 6 | 12,
  });
  const quoteBoundTargetPriceId = readString((quote.metadata as Row | null)?.canonical_target_stripe_price_id);
  if (quoteBoundTargetPriceId && quoteBoundTargetPriceId !== expectedPriceId) {
    return { ok: false as const, code: "stripe_price_mapping_changed" as const };
  }
  if (!expectedPriceId || expectedPriceId !== currentPriceId) {
    return { ok: true as const, action: "current_price_not_target" as const };
  }

  const stripeCustomerId = readString(input.subscription.customer) || readString(projection?.stripe_customer_id);
  const mutationUnix = Number(input.stripeEventCreatedAt ?? 0);
  if (!stripeCustomerId || !Number.isFinite(mutationUnix) || mutationUnix <= 0) {
    return { ok: false as const, code: "stripe_financial_correlation_missing" as const };
  }
  const quoteMetadata = quote.metadata && typeof quote.metadata === "object" ? quote.metadata as Row : {};
  const baselineValue = Number(quoteMetadata.stripe_customer_balance_before_cents);
  const actual = await collectStripePlanChangeFinancialActual(input.stripe ?? getStripeClient(), {
    stripeSubscriptionId: input.subscription.id,
    stripeCustomerId,
    mutationUnix,
    customerBalanceBeforeCents: Number.isFinite(baselineValue) ? baselineValue : null,
  });
  if (!actual) {
    return { ok: false as const, code: "stripe_financial_actual_unavailable" as const };
  }
  const actualPlanPeriodTotalCents = Number(input.subscription.items.data[0]?.price?.unit_amount ?? 0);
  const actualPeriodStartAt = input.subscription.current_period_start
    ? new Date(input.subscription.current_period_start * 1000).toISOString()
    : "";
  const actualPeriodEndAt = input.subscription.current_period_end
    ? new Date(input.subscription.current_period_end * 1000).toISOString()
    : "";
  if (
    !Number.isInteger(actualPlanPeriodTotalCents)
    || actualPlanPeriodTotalCents <= 0
    || !actualPeriodStartAt
    || !actualPeriodEndAt
    || Date.parse(actualPeriodEndAt) <= Date.parse(actualPeriodStartAt)
  ) {
    return { ok: false as const, code: "stripe_period_projection_invalid" as const };
  }

  const { data: activationResult, error: activationError } = await supabase.rpc(
    "activate_stripe_commercial_plan_change_per_account_v1",
    {
      p_quote_id: quoteId,
      p_idempotency_key: readString(quote.idempotency_key),
      p_stripe_event_id: input.stripeEventId,
      p_stripe_subscription_id: input.subscription.id,
      p_current_stripe_price_id: currentPriceId,
      p_quoted_stripe_credit_cents: Number(quote.existing_customer_credit_cents ?? 0),
      p_actual_source: actual.source,
      p_actual_amount_due_cents: actual.amountDueCents,
      p_actual_remaining_credit_cents: actual.remainingCreditCents,
      p_actual_proration_net_cents: actual.signedProrationNetCents,
      p_actual_plan_period_total_cents: actualPlanPeriodTotalCents,
      p_actual_period_start_at: actualPeriodStartAt,
      p_actual_period_end_at: actualPeriodEndAt,
      p_source_object_ids: actual.sourceObjectIds,
      p_reconciled_at: actual.reconciledAt,
    },
  );
  const activationPayload = activationResult && typeof activationResult === "object"
    ? activationResult as Row
    : {};
  if (activationError || activationPayload.ok !== true) {
    return {
      ok: false as const,
      code: readString(activationPayload.code, "stripe_plan_change_activation_failed"),
    };
  }
  const activatedCheckoutSessionId = readString(
    activationPayload.checkout_session_id,
    readString(quote.activated_checkout_session_id),
  );

  const clientId = readString(quote.client_id) || readString(projection?.client_id);
  const accountId = readString(quote.account_id) || readString(projection?.account_id);
  const { data: replacementRows } = await supabase
    .from("client_account_entitlements")
    .select("id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .eq("status", "entitlement_consumed")
    .eq("plan_key", targetPlanKey)
    .order("created_at", { ascending: false })
    .limit(1);
  const replacementEntitlementId = readString(replacementRows?.[0]?.id);
  if (!replacementEntitlementId) {
    return { ok: false as const, code: "plan_change_replacement_entitlement_missing" as const };
  }

  await upsertStripeSubscriptionProjection(supabase, {
    clientId,
    stripeSubscriptionId: input.subscription.id,
    stripeCustomerId: readString(input.subscription.customer) || readString(projection?.stripe_customer_id),
    stripePriceId: currentPriceId,
    clientAccountEntitlementId: replacementEntitlementId,
    accountId,
    commercialCheckoutSessionId: activatedCheckoutSessionId
      || readString(projection?.commercial_checkout_session_id)
      || null,
    commercialMode: readString(projection?.commercial_mode) || "full_cycle",
    pricingMode: readString(projection?.pricing_mode) || "public_catalog",
    pricingSnapshotFingerprint: readString(projection?.pricing_snapshot_fingerprint) || null,
    status: input.subscription.status,
    currentPeriodStart: input.subscription.current_period_start
      ? new Date(input.subscription.current_period_start * 1000).toISOString()
      : null,
    currentPeriodEnd: input.subscription.current_period_end
      ? new Date(input.subscription.current_period_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: input.subscription.cancel_at_period_end,
  });

  await supabase
    .from("commercial_stripe_subscriptions")
    .update({
      plan_change_quote_id: quoteId,
      metadata_safe: {
        plan_change_state: "webhook_reconciled",
        stripe_event_id: input.stripeEventId,
        canonical_stripe_price_id: currentPriceId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", input.subscription.id);

  return {
    ok: true as const,
    action: "activated_from_canonical_price_and_financial_actual" as const,
    actualSource: actual.source,
    actualAmountDueCents: actual.amountDueCents,
    actualRemainingCreditCents: actual.remainingCreditCents,
    actualPlanPeriodTotalCents,
    actualPeriodStartAt,
    actualPeriodEndAt,
  };
}
