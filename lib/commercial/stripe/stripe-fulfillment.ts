import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { activateClientAccountEntitlementFromCheckout } from "../activate-client-account-entitlement-from-checkout.ts";
import { loadCheckoutPendingSignupCredential, clearCheckoutPendingSignupCredentialIdempotent } from "../checkout-pending-signup-credential.ts";
import { activatePlanChangeQuote } from "../plan-change-quote.ts";
import {
  type StripeCheckoutAttemptRow,
  canResumeStripeAttemptFulfillment,
  findStripeCheckoutAttemptById,
  markCommercialCheckoutSessionPaid,
  markStripeCheckoutAttemptFulfilled,
  markStripeCheckoutAttemptReconciliationRequired,
  updateStripeCheckoutAttemptStatus,
} from "./stripe-checkout-attempts.ts";
import {
  validatePlanChangeCheckoutPayment,
  validateSubscriptionCheckoutPayment,
} from "./stripe-payment-confirmation.ts";
import { syncStripeSubscriptionPriceAfterPlanChangePayment } from "./stripe-plan-change-checkout.ts";
import {
  upsertStripeBillingProfile,
  upsertStripeSubscriptionProjection,
} from "./stripe-subscription-projection.ts";
import { getStripeClient } from "./stripe-client.ts";
import { assertStripeTestLivemode } from "./stripe-config.ts";
import { reconcilePaidStripeSubscriptionProjection } from "./stripe-subscription-webhook-reconciliation.ts";
import { STRIPE_ATTEMPT_STATUS, isStripeAttemptFulfilled } from "./stripe-attempt-state.ts";
import { isValidStripePriceId } from "./stripe-catalog.ts";

type Row = Record<string, unknown>;

export class StripeFulfillmentError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

async function loadSubscriptionForSession(stripe: Stripe, session: Stripe.Checkout.Session) {
  const subscriptionRef = session.subscription;
  const subscriptionId = typeof subscriptionRef === "string"
    ? subscriptionRef
    : readString(subscriptionRef?.id);
  if (!subscriptionId) {
    return null;
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  assertStripeTestLivemode(subscription.livemode);
  return subscription;
}

async function loadPaymentIntentForSession(stripe: Stripe, session: Stripe.Checkout.Session) {
  const paymentIntentRef = session.payment_intent;
  const paymentIntentId = typeof paymentIntentRef === "string"
    ? paymentIntentRef
    : readString(paymentIntentRef?.id);
  if (!paymentIntentId) {
    return null;
  }
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  assertStripeTestLivemode(paymentIntent.livemode);
  return paymentIntent;
}

export async function fulfillStripeCheckoutAttempt(
  supabase: SupabaseClient,
  input: {
    attempt: StripeCheckoutAttemptRow;
    session: Stripe.Checkout.Session;
    stripe?: Stripe;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  assertStripeTestLivemode(input.session.livemode);

  if (isStripeAttemptFulfilled(input.attempt.status)) {
    return { ok: true as const, alreadyFulfilled: true as const };
  }

  const stripe = input.stripe ?? getStripeClient();

  if (input.attempt.checkout_mode === "subscription") {
    const subscription = await loadSubscriptionForSession(stripe, input.session);
    const paymentValidation = validateSubscriptionCheckoutPayment({
      session: input.session,
      subscription,
    });
    if (!paymentValidation.ok) {
      return {
        ok: false as const,
        awaitingPayment: true as const,
        code: paymentValidation.code,
        reason: paymentValidation.reason,
      };
    }

    return fulfillSubscriptionAttempt(supabase, {
      attempt: input.attempt,
      session: input.session,
      subscriptionId: paymentValidation.subscriptionId,
      customerId: readString(input.session.customer),
      paymentIntentId: readString(input.session.payment_intent),
    }, env);
  }

  if (input.attempt.checkout_mode === "payment") {
    const paymentIntent = await loadPaymentIntentForSession(stripe, input.session);
    const paymentValidation = validatePlanChangeCheckoutPayment({
      session: input.session,
      paymentIntent,
    });
    if (!paymentValidation.ok) {
      return {
        ok: false as const,
        awaitingPayment: true as const,
        code: paymentValidation.code,
        reason: paymentValidation.reason,
      };
    }

    return fulfillPlanChangeAttempt(supabase, {
      attempt: input.attempt,
      session: input.session,
      stripe,
      paymentIntentId: readString(input.session.payment_intent) || null,
      customerId: readString(input.session.customer) || null,
    });
  }

  throw new StripeFulfillmentError("unsupported_checkout_mode", "Unsupported checkout mode.", false);
}

async function fulfillSubscriptionAttempt(
  supabase: SupabaseClient,
  input: {
    attempt: StripeCheckoutAttemptRow;
    session: Stripe.Checkout.Session;
    subscriptionId: string;
    customerId: string;
    paymentIntentId: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!input.attempt.commercial_checkout_session_id) {
    throw new StripeFulfillmentError("commercial_session_missing", "Commercial checkout session is missing.", false);
  }

  await updateStripeCheckoutAttemptStatus(supabase, input.attempt.id, {
    status: STRIPE_ATTEMPT_STATUS.FULFILLMENT_PROCESSING,
    stripeSubscriptionId: input.subscriptionId,
    stripePaymentIntentId: input.paymentIntentId || null,
    stripeCustomerId: input.customerId || null,
    paymentConfirmedAt: input.attempt.payment_confirmed_at ?? new Date().toISOString(),
  });

  const { data: checkoutSession } = await supabase
    .from("commercial_checkout_sessions")
    .select("*")
    .eq("id", input.attempt.commercial_checkout_session_id)
    .maybeSingle<Row>();

  if (!checkoutSession?.id) {
    throw new StripeFulfillmentError("commercial_session_missing", "Commercial checkout session was not found.", false);
  }

  const checkoutSessionId = readString(checkoutSession.id);
  const idempotencyKey = readString(checkoutSession.idempotency_key);
  let pendingPassword: string | null = null;
  if (readString(checkoutSession.flow_type) === "first_purchase") {
    const credential = await loadCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId,
      idempotencyKey,
      purchaserEmail: readString(checkoutSession.purchaser_email),
      flowType: "first_purchase",
      commercialMode: readString(checkoutSession.commercial_mode) === "outreach_only" ? "outreach_only" : "full_cycle",
    }, env);
    if (!credential.ok) {
      throw new StripeFulfillmentError(credential.code, credential.messageEn, false);
    }
    pendingPassword = credential.password;
  }

  const activation = await activateClientAccountEntitlementFromCheckout(supabase, {
    planKey: readString(checkoutSession.plan_key),
    billingIntervalMonths: Number(checkoutSession.billing_interval_months ?? 1),
    outreachAddonKey: readString(checkoutSession.outreach_addon_key) || null,
    purchaserEmail: readString(checkoutSession.purchaser_email),
    idempotencyKey,
    flowType: readString(checkoutSession.flow_type) === "additional_account" ? "additional_account" : "first_purchase",
    clientId: readString(checkoutSession.client_id) || input.attempt.client_id,
    authUserId: readString(checkoutSession.auth_user_id) || input.attempt.auth_user_id,
    mode: "stripe",
    stripeWebhookConfirmed: true,
    precreatedCheckoutSessionId: checkoutSessionId,
    prodTestAuthorizationId: readString((checkoutSession.metadata as Row | null)?.prod_test_authorization_id) || null,
    commercialMode: readString(checkoutSession.commercial_mode) === "outreach_only" ? "outreach_only" : "full_cycle",
    password: pendingPassword,
    passwordConfirmation: pendingPassword,
    locale: (checkoutSession.metadata as Row | null)?.auth_user_locale,
  });

  if (!activation.ok) {
    throw new StripeFulfillmentError(
      readString(activation.code, "activation_failed"),
      readString(activation.messageEn, "Activation failed."),
      true,
    );
  }

  if (readString(checkoutSession.flow_type) === "first_purchase") {
    await clearCheckoutPendingSignupCredentialIdempotent(supabase, checkoutSessionId);
  }

  if (input.customerId) {
    await upsertStripeBillingProfile(supabase, {
      clientId: activation.clientId || input.attempt.client_id,
      stripeCustomerId: input.customerId,
      billingEmail: input.attempt.purchaser_email,
    });
    await upsertStripeSubscriptionProjection(supabase, {
      clientId: activation.clientId,
      stripeSubscriptionId: input.subscriptionId,
      stripeCustomerId: input.customerId,
      stripePriceId: null,
      clientAccountEntitlementId: activation.entitlementId,
      accountId: null,
      commercialCheckoutSessionId: readString(checkoutSession.id),
      commercialMode: readString(checkoutSession.commercial_mode) === "outreach_only" ? "outreach_only" : "full_cycle",
      pricingMode: "public_catalog",
      pricingSnapshotFingerprint: readString((checkoutSession.pricing_snapshot as Row | null)?.version),
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
    await reconcilePaidStripeSubscriptionProjection(supabase, {
      clientId: activation.clientId,
      stripeCustomerId: input.customerId,
      stripeSubscriptionId: input.subscriptionId,
      correlationBasis: "checkout_fulfillment",
    });
  }

  await markCommercialCheckoutSessionPaid(supabase, readString(checkoutSession.id));
  await markStripeCheckoutAttemptFulfilled(supabase, input.attempt.id);

  return { ok: true as const, alreadyFulfilled: false as const };
}

async function fulfillPlanChangeAttempt(
  supabase: SupabaseClient,
  input: {
    attempt: StripeCheckoutAttemptRow;
    session: Stripe.Checkout.Session;
    stripe: Stripe;
    paymentIntentId: string | null;
    customerId: string | null;
  },
) {
  const quoteId = input.attempt.plan_change_quote_id;
  if (!quoteId) {
    throw new StripeFulfillmentError("quote_missing", "Plan change quote is missing.", false);
  }

  const stripeSubscriptionId = readString(input.attempt.stripe_subscription_id);
  const targetPriceId = readString(input.attempt.target_stripe_price_id);
  if (!stripeSubscriptionId) {
    throw new StripeFulfillmentError("stripe_subscription_missing", "Stripe subscription id is missing on attempt.", false);
  }
  if (!targetPriceId || !isValidStripePriceId(targetPriceId)) {
    throw new StripeFulfillmentError("target_price_missing", "Target Stripe price id is missing on attempt.", false);
  }

  await updateStripeCheckoutAttemptStatus(supabase, input.attempt.id, {
    status: STRIPE_ATTEMPT_STATUS.FULFILLMENT_PROCESSING,
    stripePaymentIntentId: input.paymentIntentId,
    stripeCustomerId: input.customerId,
    paymentConfirmedAt: input.attempt.payment_confirmed_at ?? new Date().toISOString(),
  });

  const sync = await syncStripeSubscriptionPriceAfterPlanChangePayment(input.stripe, {
    stripeSubscriptionId,
    targetPriceId,
  });
  if (!sync.ok) {
    throw new StripeFulfillmentError("stripe_subscription_sync_failed", "Stripe subscription sync failed.", true);
  }

  const { data: quoteRow } = await supabase
    .from("commercial_plan_change_quotes")
    .select("idempotency_key,status,payment_status")
    .eq("id", quoteId)
    .maybeSingle<Row>();

  if (!quoteRow?.id) {
    throw new StripeFulfillmentError("quote_missing", "Plan change quote was not found.", false);
  }

  if (readString(quoteRow.payment_status) !== "confirmed") {
    await supabase
      .from("commercial_plan_change_quotes")
      .update({
        payment_status: "confirmed",
        payment_provider: "stripe",
        provider_transaction_id: input.paymentIntentId || input.session.id,
        payment_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);
  }

  const activation = await activatePlanChangeQuote(supabase, {
    quoteId,
    idempotencyKey: readString(quoteRow.idempotency_key) || input.attempt.idempotency_key,
    actorEmail: input.attempt.purchaser_email,
    simulatedActivation: false,
  });

  if (!activation.ok) {
    throw new StripeFulfillmentError(
      readString(activation.code, "plan_change_activation_failed"),
      readString(activation.messageEn, "Plan change activation failed."),
      true,
    );
  }

  await markStripeCheckoutAttemptFulfilled(supabase, input.attempt.id);
  return { ok: true as const, alreadyFulfilled: false as const };
}

export async function recoverStripeCheckoutAttemptFulfillment(
  supabase: SupabaseClient,
  input: { attemptId: string; stripe?: Stripe },
) {
  const lookup = await findStripeCheckoutAttemptById(supabase, input.attemptId);
  if (!lookup.ok) {
    return { ok: false as const, status: 404, code: "attempt_not_found" as const };
  }

  const resume = canResumeStripeAttemptFulfillment(lookup.attempt);
  if (!resume.ok) {
    return { ok: false as const, status: 409, code: resume.code };
  }
  if (resume.alreadyFulfilled) {
    return { ok: true as const, alreadyFulfilled: true as const };
  }

  const stripe = input.stripe ?? getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(lookup.attempt.stripe_checkout_session_id);
  assertStripeTestLivemode(session.livemode);

  const result = await fulfillStripeCheckoutAttempt(supabase, {
    attempt: lookup.attempt,
    session,
    stripe,
  });

  if ("awaitingPayment" in result && result.awaitingPayment) {
    return { ok: false as const, status: 409, code: "payment_not_confirmed" as const };
  }

  return { ok: true as const, alreadyFulfilled: false as const };
}

export async function markStripeAttemptReconciliationFailure(
  supabase: SupabaseClient,
  attemptId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message.slice(0, 200) : "fulfillment_failed";
  await markStripeCheckoutAttemptReconciliationRequired(supabase, attemptId, message);
}
