import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

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
  input: {
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
  },
) {
  await supabase
    .from("commercial_stripe_subscriptions")
    .upsert({
      client_id: input.clientId,
      stripe_subscription_id: input.stripeSubscriptionId,
      stripe_customer_id: input.stripeCustomerId,
      stripe_price_id: input.stripePriceId,
      client_account_entitlement_id: input.clientAccountEntitlementId ?? null,
      account_id: input.accountId ?? null,
      commercial_checkout_session_id: input.commercialCheckoutSessionId ?? null,
      commercial_mode: input.commercialMode ?? null,
      pricing_mode: input.pricingMode ?? null,
      pricing_snapshot_fingerprint: input.pricingSnapshotFingerprint ?? null,
      status: input.status,
      livemode: false,
      current_period_start: input.currentPeriodStart,
      current_period_end: input.currentPeriodEnd,
      cancel_at_period_end: input.cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_subscription_id" });

  await supabase
    .from("commercial_stripe_billing_profiles")
    .upsert({
      client_id: input.clientId,
      stripe_customer_id: input.stripeCustomerId,
      livemode: false,
      updated_at: new Date().toISOString(),
      metadata_safe: { stripe_subscription_id: input.stripeSubscriptionId },
    }, { onConflict: "client_id" });
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
