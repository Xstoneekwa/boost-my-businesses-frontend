import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCommercialQuote } from "../pricing.ts";
import { isPlanKey, type CheckoutFlowType, type PlanKey } from "../catalog.ts";
import { evaluateCheckoutSimulationAccess } from "../checkout-simulation-access.ts";
import { resolveSimulatedPublicAuth } from "../checkout-auth.ts";
import { requireStripeTestConfig, StripeFoundationError } from "./stripe-config.ts";
import { getStripeClient } from "./stripe-client.ts";
import { resolveServerStripePriceId } from "./stripe-price-resolver.ts";
import {
  createInternalCheckoutSessionPending,
  createStripeCheckoutAttempt,
} from "./stripe-checkout-attempts.ts";
import { buildSafeStripeMetadata, rejectUnsafeStripeMetadataKeys } from "./stripe-catalog.ts";
import { isStripeTestFoundationReady, getStripeTestReadiness } from "./stripe-readiness.ts";

export type CreateStripeSubscriptionCheckoutInput = {
  planKey: string;
  billingIntervalMonths: number;
  outreachAddonKey?: string | null;
  purchaserEmail: string;
  flowType: CheckoutFlowType;
  idempotencyKey: string;
  clientId?: string | null;
  password?: string | null;
  successUrl: string;
  cancelUrl: string;
};

export type CreateStripeSubscriptionCheckoutResult =
  | { ok: true; checkoutUrl: string; internalAttemptId: string; internalCheckoutSessionId: string }
  | { ok: false; status: number; code: string; messageEn: string };

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export async function createStripeSubscriptionCheckoutSession(
  supabase: SupabaseClient,
  input: CreateStripeSubscriptionCheckoutInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreateStripeSubscriptionCheckoutResult> {
  try {
    requireStripeTestConfig(env);
  } catch (error) {
    const code = error instanceof StripeFoundationError ? error.code : "stripe_test_not_configured";
    return { ok: false, status: 503, code, messageEn: "Stripe Test checkout is not configured." };
  }

  const readiness = await getStripeTestReadiness(supabase, env);
  if (!isStripeTestFoundationReady(readiness)) {
    return { ok: false, status: 503, code: "stripe_test_not_configured", messageEn: "Stripe Test foundation is incomplete." };
  }

  if (!isPlanKey(input.planKey)) {
    return { ok: false, status: 400, code: "invalid_plan", messageEn: "Invalid plan selection." };
  }
  const planKey = input.planKey as PlanKey;
  const billingIntervalMonths = [1, 3, 6, 12].includes(Number(input.billingIntervalMonths))
    ? Number(input.billingIntervalMonths) as 1 | 3 | 6 | 12
    : 1;

  const email = readString(input.purchaserEmail).toLowerCase();
  if (!email.includes("@")) {
    return { ok: false, status: 400, code: "invalid_email", messageEn: "Valid email is required." };
  }

  const idempotencyKey = readString(input.idempotencyKey);
  if (!idempotencyKey) {
    return { ok: false, status: 400, code: "idempotency_required", messageEn: "Idempotency key is required." };
  }

  const flowType = input.flowType === "additional_account" ? "additional_account" : "first_purchase";

  const simulationAccess = await evaluateCheckoutSimulationAccess({
    supabase,
    email,
    flowType,
    clientId: input.clientId ?? null,
    planKey,
    billingIntervalMonths,
  });
  if (!simulationAccess.allowed && flowType === "first_purchase") {
    return {
      ok: false,
      status: 403,
      code: readString(simulationAccess.reason, "authorization_required"),
      messageEn: simulationAccess.messageEn ?? "Checkout authorization is required.",
    };
  }

  const quote = buildCommercialQuote({
    planKey,
    billingIntervalMonths,
    outreachAddonKey: input.outreachAddonKey,
    linkedAccountCount: 0,
    reservedEntitlementCount: 0,
    pricingContext: flowType === "additional_account" ? "new_account" : "first_purchase",
  });
  if ("error" in quote) {
    return { ok: false, status: 400, code: quote.error, messageEn: "Invalid checkout selection." };
  }

  const stripePriceId = await resolveServerStripePriceId(supabase, {
    environment: "test",
    planKey,
    billingIntervalMonths,
    outreachAddonKey: input.outreachAddonKey,
  });
  if (!stripePriceId) {
    return { ok: false, status: 503, code: "stripe_price_mapping_missing", messageEn: "Stripe test price mapping is missing." };
  }

  let authUserId: string | null = null;
  let clientId = input.clientId ?? null;

  if (flowType === "first_purchase") {
    const password = readString(input.password);
    if (!password) {
      return { ok: false, status: 400, code: "password_required", messageEn: "Password is required for first purchase." };
    }
    const authResult = await resolveSimulatedPublicAuth(supabase, {
      email,
      password,
      idempotencyKey,
    });
    if (!authResult.ok) {
      return {
        ok: false,
        status: 409,
        code: authResult.code,
        messageEn: authResult.messageEn,
      };
    }
    authUserId = authResult.authUserId;
    clientId = authResult.resumeClientId;
  }

  const pendingSession = await createInternalCheckoutSessionPending(supabase, {
    idempotencyKey,
    flowType,
    purchaserEmail: email,
    clientId,
    authUserId,
    planKey,
    billingIntervalMonths,
    outreachAddonKey: input.outreachAddonKey,
    quoteSnapshot: quote as unknown as Record<string, unknown>,
    pricingSnapshot: quote.pricingSnapshot as unknown as Record<string, unknown>,
    catalogSnapshot: quote.catalogSnapshot as unknown as Record<string, unknown>,
    totalPeriodCents: quote.totalPeriodCents,
  });
  if (!pendingSession.ok) {
    return { ok: false, status: 503, code: pendingSession.code, messageEn: "Could not create internal checkout session." };
  }

  const metadata = buildSafeStripeMetadata({
    internal_attempt_id: idempotencyKey,
    internal_checkout_session_id: pendingSession.checkoutSessionId,
    flow_type: flowType,
  });
  rejectUnsafeStripeMetadataKeys(metadata);

  const stripe = getStripeClient(env);
  const stripeSession = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    client_reference_id: pendingSession.checkoutSessionId,
    line_items: [{ price: stripePriceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata,
    subscription_data: {
      metadata,
    },
  });

  if (!stripeSession.id || !stripeSession.url) {
    return { ok: false, status: 503, code: "stripe_session_create_failed", messageEn: "Stripe checkout session could not be created." };
  }

  const attempt = await createStripeCheckoutAttempt(supabase, {
    commercialCheckoutSessionId: pendingSession.checkoutSessionId,
    idempotencyKey,
    flowType,
    stripeCheckoutSessionId: stripeSession.id,
    checkoutMode: "subscription",
    purchaserEmail: email,
    clientId,
    authUserId,
    stripeCustomerId: typeof stripeSession.customer === "string" ? stripeSession.customer : null,
    metadataSafe: metadata,
  });
  if (!attempt.ok) {
    return { ok: false, status: 503, code: attempt.code, messageEn: "Could not record Stripe checkout attempt." };
  }

  return {
    ok: true,
    checkoutUrl: stripeSession.url,
    internalAttemptId: attempt.attemptId,
    internalCheckoutSessionId: pendingSession.checkoutSessionId,
  };
}
