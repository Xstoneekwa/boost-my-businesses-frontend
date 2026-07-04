import type { SupabaseClient } from "@supabase/supabase-js";
import {
  shouldApplySubscriptionStatus,
} from "./stripe-subscription-projection-state.ts";

type Row = Record<string, unknown>;

export type StripeSubscriptionProjectionInput = {
  clientId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  stripePriceId: string | null;
  clientAccountEntitlementId?: string | null;
  accountId?: string | null;
  commercialCheckoutSessionId?: string | null;
  commercialMode?: string | null;
  pricingMode?: string | null;
  pricingSnapshotFingerprint?: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billingPaused?: boolean;
  pauseCollectionBehavior?: string | null;
  incomingIsTerminalEvent?: boolean;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function readNullableString(value: unknown) {
  const normalized = readString(value);
  return normalized || null;
}

export function mergeStripeSubscriptionProjectionInput(
  existing: Row | null | undefined,
  incoming: StripeSubscriptionProjectionInput,
) {
  const existingStatus = readString(existing?.status);
  const appliedStatus = shouldApplySubscriptionStatus(existingStatus, incoming.status, {
    incomingIsTerminalEvent: incoming.incomingIsTerminalEvent,
  })
    ? incoming.status
    : (existingStatus || incoming.status);

  const statusChanged = appliedStatus === incoming.status;

  return {
    client_id: incoming.clientId,
    stripe_subscription_id: incoming.stripeSubscriptionId,
    stripe_customer_id: incoming.stripeCustomerId,
    stripe_price_id: incoming.stripePriceId ?? readNullableString(existing?.stripe_price_id),
    client_account_entitlement_id: readNullableString(incoming.clientAccountEntitlementId)
      ?? readNullableString(existing?.client_account_entitlement_id),
    account_id: readNullableString(incoming.accountId) ?? readNullableString(existing?.account_id),
    commercial_checkout_session_id: readNullableString(incoming.commercialCheckoutSessionId)
      ?? readNullableString(existing?.commercial_checkout_session_id),
    commercial_mode: readNullableString(incoming.commercialMode) ?? readNullableString(existing?.commercial_mode),
    pricing_mode: readNullableString(incoming.pricingMode) ?? readNullableString(existing?.pricing_mode),
    pricing_snapshot_fingerprint: readNullableString(incoming.pricingSnapshotFingerprint)
      ?? readNullableString(existing?.pricing_snapshot_fingerprint),
    status: appliedStatus,
    livemode: false,
    current_period_start: statusChanged
      ? incoming.currentPeriodStart
      : (incoming.currentPeriodStart ?? readNullableString(existing?.current_period_start)),
    current_period_end: statusChanged
      ? incoming.currentPeriodEnd
      : (incoming.currentPeriodEnd ?? readNullableString(existing?.current_period_end)),
    cancel_at_period_end: statusChanged
      ? incoming.cancelAtPeriodEnd
      : (incoming.cancelAtPeriodEnd ?? existing?.cancel_at_period_end === true),
    billing_paused: incoming.billingPaused ?? existing?.billing_paused === true,
    pause_collection_behavior: readNullableString(incoming.pauseCollectionBehavior)
      ?? readNullableString(existing?.pause_collection_behavior),
    updated_at: new Date().toISOString(),
  };
}

export async function loadStripeSubscriptionProjection(
  supabase: SupabaseClient,
  stripeSubscriptionId: string,
) {
  const { data } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("*")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle<Row>();
  return data ?? null;
}

export async function upsertStripeBillingProfile(
  supabase: SupabaseClient,
  input: {
    clientId: string | null;
    stripeCustomerId: string;
    billingEmail?: string | null;
  },
) {
  if (!input.clientId) return;
  await supabase
    .from("commercial_stripe_billing_profiles")
    .upsert({
      client_id: input.clientId,
      stripe_customer_id: input.stripeCustomerId,
      livemode: false,
      billing_email: input.billingEmail ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" });
}

export async function upsertStripeSubscriptionProjection(
  supabase: SupabaseClient,
  input: StripeSubscriptionProjectionInput,
) {
  const existing = await loadStripeSubscriptionProjection(supabase, input.stripeSubscriptionId);
  const payload = mergeStripeSubscriptionProjectionInput(existing, input);

  await supabase
    .from("commercial_stripe_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  await supabase
    .from("commercial_stripe_billing_profiles")
    .upsert({
      client_id: input.clientId,
      stripe_customer_id: input.stripeCustomerId,
      livemode: false,
      updated_at: new Date().toISOString(),
      metadata_safe: { stripe_subscription_id: input.stripeSubscriptionId },
    }, { onConflict: "client_id" });

  return {
    appliedStatus: payload.status,
    downgradedBlocked: payload.status !== input.status,
  };
}

export async function createStripeBillingPortalSession(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    returnUrl: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const { requireStripeTestConfig } = await import("./stripe-config.ts");
  const { getStripeClient } = await import("./stripe-client.ts");
  const config = requireStripeTestConfig(env);
  if (!config.billingPortalConfigurationId) {
    return { ok: false as const, code: "stripe_portal_not_configured" as const };
  }

  const { data: profile } = await supabase
    .from("commercial_stripe_billing_profiles")
    .select("stripe_customer_id")
    .eq("client_id", input.clientId)
    .maybeSingle<Row>();

  const customerId = typeof profile?.stripe_customer_id === "string" ? profile.stripe_customer_id : "";
  if (!customerId) {
    return { ok: false as const, code: "stripe_customer_missing" as const };
  }

  const stripe = getStripeClient(env);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: input.returnUrl,
    configuration: config.billingPortalConfigurationId,
  });

  if (!session.url) {
    return { ok: false as const, code: "stripe_portal_create_failed" as const };
  }
  return { ok: true as const, url: session.url };
}
