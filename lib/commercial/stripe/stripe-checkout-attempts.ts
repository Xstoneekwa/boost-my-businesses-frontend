import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckoutFlowType } from "../catalog.ts";
import { buildSafeStripeMetadata, rejectUnsafeStripeMetadataKeys } from "./stripe-catalog.ts";
import { STRIPE_ATTEMPT_STATUS, isStripeAttemptFulfilled } from "./stripe-attempt-state.ts";

type Row = Record<string, unknown>;

export type StripeCheckoutAttemptRow = {
  id: string;
  commercial_checkout_session_id: string | null;
  plan_change_quote_id: string | null;
  idempotency_key: string;
  flow_type: CheckoutFlowType;
  stripe_checkout_session_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_payment_intent_id: string | null;
  target_stripe_price_id: string | null;
  client_account_entitlement_id: string | null;
  account_id: string | null;
  commercial_mode: string | null;
  pricing_snapshot_fingerprint: string | null;
  checkout_mode: "subscription" | "payment";
  status: string;
  client_id: string | null;
  auth_user_id: string | null;
  purchaser_email: string;
  metadata_safe: Record<string, unknown>;
  payment_confirmed_at: string | null;
  fulfilled_at: string | null;
  fulfillment_error_redacted: string | null;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function normalizeAttemptRow(data: Row): StripeCheckoutAttemptRow {
  return {
    id: readString(data.id),
    commercial_checkout_session_id: readString(data.commercial_checkout_session_id) || null,
    plan_change_quote_id: readString(data.plan_change_quote_id) || null,
    idempotency_key: readString(data.idempotency_key),
    flow_type: readString(data.flow_type) as CheckoutFlowType,
    stripe_checkout_session_id: readString(data.stripe_checkout_session_id),
    stripe_customer_id: readString(data.stripe_customer_id) || null,
    stripe_subscription_id: readString(data.stripe_subscription_id) || null,
    stripe_payment_intent_id: readString(data.stripe_payment_intent_id) || null,
    target_stripe_price_id: readString(data.target_stripe_price_id) || null,
    client_account_entitlement_id: readString(data.client_account_entitlement_id) || null,
    account_id: readString(data.account_id) || null,
    commercial_mode: readString(data.commercial_mode) || null,
    pricing_snapshot_fingerprint: readString(data.pricing_snapshot_fingerprint) || null,
    checkout_mode: readString(data.checkout_mode) as "subscription" | "payment",
    status: readString(data.status),
    client_id: readString(data.client_id) || null,
    auth_user_id: readString(data.auth_user_id) || null,
    purchaser_email: readString(data.purchaser_email),
    metadata_safe: (data.metadata_safe && typeof data.metadata_safe === "object")
      ? data.metadata_safe as Record<string, unknown>
      : {},
    payment_confirmed_at: readString(data.payment_confirmed_at) || null,
    fulfilled_at: readString(data.fulfilled_at) || null,
    fulfillment_error_redacted: readString(data.fulfillment_error_redacted) || null,
  };
}

export async function createInternalCheckoutSessionPending(
  supabase: SupabaseClient,
  input: {
    idempotencyKey: string;
    flowType: CheckoutFlowType;
    purchaserEmail: string;
    clientId?: string | null;
    authUserId?: string | null;
    planKey?: string | null;
    billingIntervalMonths: number;
    outreachAddonKey?: string | null;
    commercialMode?: string | null;
    pricingSnapshotFingerprint?: string | null;
    quoteSnapshot: Record<string, unknown>;
    pricingSnapshot: Record<string, unknown>;
    catalogSnapshot: Record<string, unknown>;
    totalPeriodCents: number;
    metadataSafe?: Record<string, unknown>;
  },
) {
  const { data: existing, error: existingError } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,commercial_mode,plan_key,billing_interval_months,outreach_addon_key")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle<Row>();
  if (existingError) {
    return { ok: false as const, code: "checkout_session_lookup_failed" as const };
  }
  if (existing?.id) {
    if (
      readString(existing.commercial_mode) !== readString(input.commercialMode)
      || readString(existing.plan_key) !== readString(input.planKey)
      || Number(existing.billing_interval_months) !== Number(input.billingIntervalMonths)
      || readString(existing.outreach_addon_key) !== readString(input.outreachAddonKey)
    ) {
      return { ok: false as const, code: "checkout_idempotency_conflict" as const };
    }
    return { ok: true as const, checkoutSessionId: String(existing.id), idempotentReplay: true as const };
  }

  const { data, error } = await supabase
    .from("commercial_checkout_sessions")
    .insert({
      idempotency_key: input.idempotencyKey,
      flow_type: input.flowType,
      status: "checkout_pending_payment",
      client_id: input.clientId ?? null,
      auth_user_id: input.authUserId ?? null,
      purchaser_email: input.purchaserEmail,
      plan_key: input.planKey ?? null,
      billing_interval_months: input.billingIntervalMonths,
      outreach_addon_key: input.outreachAddonKey ?? null,
      commercial_mode: input.commercialMode ?? null,
      stripe_pricing_mode: "public_catalog",
      pricing_snapshot_fingerprint: input.pricingSnapshotFingerprint ?? null,
      billable_account_count: Number(input.quoteSnapshot.billableAccountCount ?? 1),
      term_discount_percent: Number(input.quoteSnapshot.termDiscountPercent ?? 0),
      agency_discount_percent: Number(input.quoteSnapshot.agencyDiscountPercent ?? 0),
      applied_discount_percent: Number(input.quoteSnapshot.appliedDiscountPercent ?? 0),
      applied_discount_type: String(input.quoteSnapshot.appliedDiscountType ?? "none"),
      pack_base_monthly_cents: Number((input.quoteSnapshot.packLine as Row)?.baseMonthlyPriceCents ?? 0),
      pack_monthly_discounted_cents: Number((input.quoteSnapshot.packLine as Row)?.monthlyDiscountedPriceCents ?? 0),
      pack_period_total_cents: Number((input.quoteSnapshot.packLine as Row)?.billingPeriodTotalCents ?? 0),
      outreach_base_monthly_cents: (input.quoteSnapshot.outreachLine as Row | null)?.baseMonthlyPriceCents ?? null,
      outreach_monthly_discounted_cents: (input.quoteSnapshot.outreachLine as Row | null)?.monthlyDiscountedPriceCents ?? null,
      outreach_period_total_cents: (input.quoteSnapshot.outreachLine as Row | null)?.billingPeriodTotalCents ?? null,
      total_period_cents: input.totalPeriodCents,
      catalog_snapshot: input.catalogSnapshot,
      pricing_snapshot: input.pricingSnapshot,
      metadata: {
        mode: "stripe_test",
        payment_provider: "stripe",
        payment_status: "pending",
        ...(input.metadataSafe ?? {}),
      },
    })
    .select("id")
    .single<Row>();

  if (error || !data?.id) {
    return { ok: false as const, code: "checkout_session_create_failed" as const };
  }
  return { ok: true as const, checkoutSessionId: String(data.id) };
}

export async function createStripeCheckoutAttempt(
  supabase: SupabaseClient,
  input: {
    commercialCheckoutSessionId?: string | null;
    planChangeQuoteId?: string | null;
    idempotencyKey: string;
    flowType: CheckoutFlowType;
    stripeCheckoutSessionId: string;
    checkoutMode: "subscription" | "payment";
    purchaserEmail: string;
    clientId?: string | null;
    authUserId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    targetStripePriceId?: string | null;
    clientAccountEntitlementId?: string | null;
    accountId?: string | null;
    commercialMode?: string | null;
    pricingSnapshotFingerprint?: string | null;
    metadataSafe?: Record<string, string>;
  },
) {
  const metadata = buildSafeStripeMetadata(input.metadataSafe ?? {});
  rejectUnsafeStripeMetadataKeys(metadata);

  const { data: existing, error: existingError } = await supabase
    .from("commercial_stripe_checkout_attempts")
    .select("id")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle<Row>();
  if (existingError) {
    return { ok: false as const, code: "stripe_attempt_lookup_failed" as const };
  }
  if (existing?.id) {
    return { ok: true as const, attemptId: String(existing.id), idempotentReplay: true as const };
  }

  const { data, error } = await supabase
    .from("commercial_stripe_checkout_attempts")
    .insert({
      commercial_checkout_session_id: input.commercialCheckoutSessionId ?? null,
      plan_change_quote_id: input.planChangeQuoteId ?? null,
      idempotency_key: input.idempotencyKey,
      flow_type: input.flowType,
      stripe_checkout_session_id: input.stripeCheckoutSessionId,
      checkout_mode: input.checkoutMode,
      livemode: false,
      status: STRIPE_ATTEMPT_STATUS.SESSION_CREATED,
      purchaser_email: input.purchaserEmail,
      client_id: input.clientId ?? null,
      auth_user_id: input.authUserId ?? null,
      stripe_customer_id: input.stripeCustomerId ?? null,
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      target_stripe_price_id: input.targetStripePriceId ?? null,
      client_account_entitlement_id: input.clientAccountEntitlementId ?? null,
      account_id: input.accountId ?? null,
      commercial_mode: input.commercialMode ?? null,
      pricing_snapshot_fingerprint: input.pricingSnapshotFingerprint ?? null,
      metadata_safe: metadata,
    })
    .select("id")
    .single<Row>();

  if (error || !data?.id) {
    return { ok: false as const, code: "stripe_attempt_create_failed" as const };
  }
  return { ok: true as const, attemptId: String(data.id) };
}

export async function findStripeCheckoutAttemptByStripeSessionId(
  supabase: SupabaseClient,
  stripeCheckoutSessionId: string,
) {
  const { data, error } = await supabase
    .from("commercial_stripe_checkout_attempts")
    .select("*")
    .eq("stripe_checkout_session_id", stripeCheckoutSessionId)
    .maybeSingle<Row>();

  if (error || !data?.id) {
    return { ok: false as const, code: "attempt_not_found" as const };
  }
  return { ok: true as const, attempt: normalizeAttemptRow(data) };
}

export async function findStripeCheckoutAttemptById(
  supabase: SupabaseClient,
  attemptId: string,
) {
  const { data, error } = await supabase
    .from("commercial_stripe_checkout_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle<Row>();

  if (error || !data?.id) {
    return { ok: false as const, code: "attempt_not_found" as const };
  }
  return { ok: true as const, attempt: normalizeAttemptRow(data) };
}

export async function updateStripeCheckoutAttemptStatus(
  supabase: SupabaseClient,
  attemptId: string,
  input: {
    status: string;
    stripeSubscriptionId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeCustomerId?: string | null;
    paymentConfirmedAt?: string | null;
    fulfilledAt?: string | null;
    fulfillmentErrorRedacted?: string | null;
  },
) {
  const patch: Row = {
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  if (input.stripeSubscriptionId !== undefined) patch.stripe_subscription_id = input.stripeSubscriptionId;
  if (input.stripePaymentIntentId !== undefined) patch.stripe_payment_intent_id = input.stripePaymentIntentId;
  if (input.stripeCustomerId !== undefined) patch.stripe_customer_id = input.stripeCustomerId;
  if (input.paymentConfirmedAt !== undefined) patch.payment_confirmed_at = input.paymentConfirmedAt;
  if (input.fulfilledAt !== undefined) {
    patch.fulfilled_at = input.fulfilledAt;
    patch.completed_at = input.fulfilledAt;
  }
  if (input.fulfillmentErrorRedacted !== undefined) {
    patch.fulfillment_error_redacted = input.fulfillmentErrorRedacted
      ? String(input.fulfillmentErrorRedacted).slice(0, 500)
      : null;
  }

  await supabase
    .from("commercial_stripe_checkout_attempts")
    .update(patch)
    .eq("id", attemptId);
}

export async function markStripeCheckoutAttemptAwaitingPayment(
  supabase: SupabaseClient,
  attemptId: string,
  input: { reason: string },
) {
  await updateStripeCheckoutAttemptStatus(supabase, attemptId, {
    status: STRIPE_ATTEMPT_STATUS.AWAITING_PAYMENT,
    fulfillmentErrorRedacted: input.reason.slice(0, 200),
  });
}

export async function markStripeCheckoutAttemptPaymentConfirmed(
  supabase: SupabaseClient,
  attemptId: string,
  input: {
    stripeSubscriptionId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeCustomerId?: string | null;
  },
) {
  const now = new Date().toISOString();
  await updateStripeCheckoutAttemptStatus(supabase, attemptId, {
    status: STRIPE_ATTEMPT_STATUS.PAYMENT_CONFIRMED,
    stripeSubscriptionId: input.stripeSubscriptionId ?? null,
    stripePaymentIntentId: input.stripePaymentIntentId ?? null,
    stripeCustomerId: input.stripeCustomerId ?? null,
    paymentConfirmedAt: now,
  });
}

export async function markStripeCheckoutAttemptFulfilled(
  supabase: SupabaseClient,
  attemptId: string,
) {
  const now = new Date().toISOString();
  await updateStripeCheckoutAttemptStatus(supabase, attemptId, {
    status: STRIPE_ATTEMPT_STATUS.FULFILLED,
    fulfilledAt: now,
    fulfillmentErrorRedacted: null,
  });
}

export async function markStripeCheckoutAttemptReconciliationRequired(
  supabase: SupabaseClient,
  attemptId: string,
  errorRedacted: string,
) {
  await updateStripeCheckoutAttemptStatus(supabase, attemptId, {
    status: STRIPE_ATTEMPT_STATUS.RECONCILIATION_REQUIRED,
    fulfillmentErrorRedacted: errorRedacted.slice(0, 500),
  });
}

export async function markCommercialCheckoutSessionPaid(
  supabase: SupabaseClient,
  checkoutSessionId: string,
) {
  await supabase
    .from("commercial_checkout_sessions")
    .update({
      status: "checkout_paid",
      activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        mode: "stripe_test",
        payment_provider: "stripe",
        payment_status: "confirmed",
      },
    })
    .eq("id", checkoutSessionId);
}

export function canResumeStripeAttemptFulfillment(attempt: StripeCheckoutAttemptRow) {
  if (isStripeAttemptFulfilled(attempt.status)) {
    return { ok: true as const, alreadyFulfilled: true as const };
  }
  if (
    attempt.status === STRIPE_ATTEMPT_STATUS.PAYMENT_CONFIRMED
    || attempt.status === STRIPE_ATTEMPT_STATUS.RECONCILIATION_REQUIRED
    || attempt.status === STRIPE_ATTEMPT_STATUS.FAILED_RECOVERABLE
    || attempt.status === STRIPE_ATTEMPT_STATUS.FULFILLMENT_PROCESSING
  ) {
    return { ok: true as const, alreadyFulfilled: false as const };
  }
  return { ok: false as const, code: "attempt_not_recoverable" as const };
}

// Legacy export kept for compatibility with any external references.
export const markStripeCheckoutAttemptCompleted = markStripeCheckoutAttemptFulfilled;
