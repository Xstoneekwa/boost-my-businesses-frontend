import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckoutFlowType } from "../catalog.ts";
import { buildSafeStripeMetadata, rejectUnsafeStripeMetadataKeys } from "./stripe-catalog.ts";

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
  checkout_mode: "subscription" | "payment";
  status: string;
  client_id: string | null;
  auth_user_id: string | null;
  purchaser_email: string;
  metadata_safe: Record<string, unknown>;
};

export async function createInternalCheckoutSessionPending(
  supabase: SupabaseClient,
  input: {
    idempotencyKey: string;
    flowType: CheckoutFlowType;
    purchaserEmail: string;
    clientId?: string | null;
    authUserId?: string | null;
    planKey: string;
    billingIntervalMonths: number;
    outreachAddonKey?: string | null;
    quoteSnapshot: Record<string, unknown>;
    pricingSnapshot: Record<string, unknown>;
    catalogSnapshot: Record<string, unknown>;
    totalPeriodCents: number;
  },
) {
  const { data, error } = await supabase
    .from("commercial_checkout_sessions")
    .insert({
      idempotency_key: input.idempotencyKey,
      flow_type: input.flowType,
      status: "checkout_pending_payment",
      client_id: input.clientId ?? null,
      auth_user_id: input.authUserId ?? null,
      purchaser_email: input.purchaserEmail,
      plan_key: input.planKey,
      billing_interval_months: input.billingIntervalMonths,
      outreach_addon_key: input.outreachAddonKey ?? null,
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
    metadataSafe?: Record<string, string>;
  },
) {
  const metadata = buildSafeStripeMetadata(input.metadataSafe ?? {});
  rejectUnsafeStripeMetadataKeys(metadata);

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
      status: "session_created",
      purchaser_email: input.purchaserEmail,
      client_id: input.clientId ?? null,
      auth_user_id: input.authUserId ?? null,
      stripe_customer_id: input.stripeCustomerId ?? null,
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
  return { ok: true as const, attempt: data as StripeCheckoutAttemptRow };
}

export async function markStripeCheckoutAttemptCompleted(
  supabase: SupabaseClient,
  attemptId: string,
  input: {
    stripeSubscriptionId?: string | null;
    stripePaymentIntentId?: string | null;
    stripeCustomerId?: string | null;
  },
) {
  await supabase
    .from("commercial_stripe_checkout_attempts")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      stripe_payment_intent_id: input.stripePaymentIntentId ?? null,
      stripe_customer_id: input.stripeCustomerId ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", attemptId);
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
