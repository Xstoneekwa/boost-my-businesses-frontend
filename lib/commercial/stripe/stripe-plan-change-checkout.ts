import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStripeTestConfig, StripeFoundationError, assertStripeTestLivemode } from "./stripe-config.ts";
import { getStripeClient } from "./stripe-client.ts";
import { resolveServerStripePriceId } from "./stripe-price-resolver.ts";
import { createStripeCheckoutAttempt } from "./stripe-checkout-attempts.ts";
import { buildSafeStripeMetadata, rejectUnsafeStripeMetadataKeys } from "./stripe-catalog.ts";
import { isPlanKey, type PlanKey } from "../catalog.ts";
import { isStripeTestFoundationReady, getStripeTestReadiness } from "./stripe-readiness.ts";

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

async function resolveClientStripeSubscription(
  supabase: SupabaseClient,
  clientId: string,
) {
  const { data: subscriptionRow } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("stripe_subscription_id")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();

  return readString(subscriptionRow?.stripe_subscription_id) || null;
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
  if (amountDueCents <= 0) {
    return { ok: false as const, status: 400, code: "stripe_not_required", messageEn: "This plan change does not require Stripe payment." };
  }

  if (readString(quote.status) !== "quote_pending") {
    return { ok: false as const, status: 409, code: "quote_not_pending", messageEn: "Quote is no longer pending." };
  }

  const targetPlanKey = readString(quote.target_plan_key);
  if (!isPlanKey(targetPlanKey)) {
    return { ok: false as const, status: 400, code: "invalid_plan", messageEn: "Invalid target plan." };
  }

  const billingIntervalMonths = Number(quote.billing_interval_months ?? 1) as 1 | 3 | 6 | 12;
  const stripeSubscriptionId = await resolveClientStripeSubscription(supabase, input.clientId);
  if (!stripeSubscriptionId) {
    return {
      ok: false as const,
      status: 503,
      code: "stripe_subscription_missing",
      messageEn: "Stripe subscription is required before plan change checkout.",
    };
  }

  const targetPriceId = await resolveServerStripePriceId(supabase, {
    environment: "test",
    planKey: targetPlanKey as PlanKey,
    billingIntervalMonths,
    outreachAddonKey: null,
  });
  if (!targetPriceId) {
    return {
      ok: false as const,
      status: 503,
      code: "stripe_price_mapping_missing",
      messageEn: "Stripe test price mapping is missing for the target plan.",
    };
  }

  const metadata = buildSafeStripeMetadata({
    internal_attempt_id: input.idempotencyKey,
    quote_id: input.quoteId,
    source_revision: readString(quote.source_revision),
    flow_type: "plan_change",
  });
  rejectUnsafeStripeMetadataKeys(metadata);

  const stripe = getStripeClient(env);
  const stripeSession = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.purchaserEmail,
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
    payment_method_types: ["card"],
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
    purchaserEmail: input.purchaserEmail,
    clientId: input.clientId,
    stripeSubscriptionId,
    targetStripePriceId: targetPriceId,
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
    proration_behavior: "none",
    billing_cycle_anchor: "unchanged",
  };

  if (input.preservePeriodEndUnix) {
    updateParams.cancel_at = undefined;
  }

  await stripe.subscriptions.update(input.stripeSubscriptionId, updateParams);
  return { ok: true as const };
}
