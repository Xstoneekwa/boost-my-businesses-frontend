import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { claimStripeWebhookEvent, finishStripeWebhookEvent } from "./stripe-webhook-ledger.ts";
import {
  findStripeCheckoutAttemptByStripeSessionId,
  markStripeCheckoutAttemptAwaitingPayment,
  markStripeCheckoutAttemptPaymentConfirmed,
} from "./stripe-checkout-attempts.ts";
import {
  fulfillStripeCheckoutAttempt,
  markStripeAttemptReconciliationFailure,
  StripeFulfillmentError,
} from "./stripe-fulfillment.ts";
import {
  buildStripeSubscriptionSnapshot,
  patchStripeWebhookEventMetadata,
  reconcilePaidStripeSubscriptionProjection,
  resolveStripeSubscriptionWebhookCorrelation,
} from "./stripe-subscription-webhook-reconciliation.ts";
import { clearCheckoutPendingSignupCredentialIdempotent } from "../checkout-pending-signup-credential.ts";
import { assertStripeTestLivemode, requireStripeTestConfig } from "./stripe-config.ts";
import { getStripeClient } from "./stripe-client.ts";
import { mapAttemptStatusToCommercialStatus, isStripeAttemptFulfilled } from "./stripe-attempt-state.ts";
import {
  validatePlanChangeCheckoutPayment,
  validateSubscriptionCheckoutPayment,
} from "./stripe-payment-confirmation.ts";

type Row = Record<string, unknown>;

const ALLOWED_STRIPE_WEBHOOK_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = requireStripeTestConfig(env);
  if (!config.webhookSecret) {
    return { ok: false as const, code: "stripe_test_not_configured" as const };
  }
  if (!signatureHeader) {
    return { ok: false as const, code: "stripe_signature_missing" as const };
  }
  try {
    const stripe = getStripeClient(env);
    const event = stripe.webhooks.constructEvent(rawBody, signatureHeader, config.webhookSecret);
    assertStripeTestLivemode(event.livemode);
    return { ok: true as const, event };
  } catch {
    return { ok: false as const, code: "stripe_signature_invalid" as const };
  }
}

export async function handleStripeWebhookEvent(
  supabase: SupabaseClient,
  event: Stripe.Event,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (event.livemode) {
    return { ok: false as const, status: 400, code: "stripe_livemode_rejected" as const };
  }
  if (!ALLOWED_STRIPE_WEBHOOK_EVENTS.has(event.type)) {
    return { ok: false as const, status: 400, code: "stripe_event_type_not_allowed" as const };
  }

  const claim = await claimStripeWebhookEvent(supabase, {
    stripeEventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
    stripeObjectId: readObjectId(event),
    stripeCustomerId: readCustomerId(event),
    stripeSubscriptionId: readSubscriptionId(event),
    stripeCheckoutSessionId: readCheckoutSessionId(event),
    metadataSafe: { type: event.type },
  });

  if (!claim.ok) {
    return { ok: false as const, status: claim.status, code: claim.code };
  }
  if (claim.deduplicated) {
    return { ok: true as const, status: 200, deduplicated: true as const };
  }

  const eventRowId = claim.eventRowId;
  if (!eventRowId) {
    return { ok: false as const, status: 503, code: "webhook_ledger_unavailable" as const };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionFulfillmentEvent(supabase, event, env);
        break;
      case "checkout.session.expired":
        await handleCheckoutSessionExpired(supabase, event);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionProjectionEvent(supabase, event, { eventRowId });
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
        await handleInvoiceEvent(supabase, event);
        break;
      default:
        throw new StripeFulfillmentError("stripe_event_type_not_allowed", "Unsupported Stripe event type.", false);
    }

    await finishStripeWebhookEvent(supabase, {
      eventRowId,
      status: "processed",
    });
    return { ok: true as const, status: 200, processed: true as const };
  } catch (error) {
    const retryable = !(error instanceof StripeFulfillmentError) || error.retryable;
    await finishStripeWebhookEvent(supabase, {
      eventRowId,
      status: retryable ? "retryable" : "failed",
      errorRedacted: error instanceof Error ? error.message.slice(0, 200) : "handler_failed",
    });
    return {
      ok: false as const,
      status: retryable ? 500 : 422,
      code: error instanceof StripeFulfillmentError ? error.code : "webhook_handler_failed",
    };
  }
}

async function handleCheckoutSessionFulfillmentEvent(
  supabase: SupabaseClient,
  event: Stripe.Event,
  env: NodeJS.ProcessEnv = process.env,
) {
  const session = event.data.object as Stripe.Checkout.Session;
  assertStripeTestLivemode(session.livemode);

  const attemptLookup = await findStripeCheckoutAttemptByStripeSessionId(supabase, session.id);
  if (!attemptLookup.ok) {
    throw new StripeFulfillmentError("attempt_not_found", "Checkout attempt not found for Stripe session.", false);
  }

  const attempt = attemptLookup.attempt;
  if (isStripeAttemptFulfilled(attempt.status)) {
    return;
  }

  const stripe = getStripeClient();
  if (attempt.checkout_mode === "subscription") {
    const subscriptionRef = session.subscription;
    const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : readString(subscriptionRef?.id);
    const subscription = subscriptionId ? await stripe.subscriptions.retrieve(subscriptionId) : null;
    const validation = validateSubscriptionCheckoutPayment({ session, subscription });
    if (!validation.ok) {
      await markStripeCheckoutAttemptAwaitingPayment(supabase, attempt.id, { reason: validation.reason });
      return;
    }
    await markStripeCheckoutAttemptPaymentConfirmed(supabase, attempt.id, {
      stripeSubscriptionId: validation.subscriptionId,
      stripePaymentIntentId: readString(session.payment_intent),
      stripeCustomerId: readString(session.customer),
    });
  } else {
    const paymentIntentRef = session.payment_intent;
    const paymentIntentId = typeof paymentIntentRef === "string" ? paymentIntentRef : readString(paymentIntentRef?.id);
    const paymentIntent = paymentIntentId ? await stripe.paymentIntents.retrieve(paymentIntentId) : null;
    const validation = validatePlanChangeCheckoutPayment({ session, paymentIntent });
    if (!validation.ok) {
      await markStripeCheckoutAttemptAwaitingPayment(supabase, attempt.id, { reason: validation.reason });
      return;
    }
    await markStripeCheckoutAttemptPaymentConfirmed(supabase, attempt.id, {
      stripePaymentIntentId: paymentIntentId,
      stripeCustomerId: readString(session.customer),
    });
  }

  const refreshed = await findStripeCheckoutAttemptByStripeSessionId(supabase, session.id);
  if (!refreshed.ok) {
    throw new StripeFulfillmentError("attempt_not_found", "Checkout attempt not found.", false);
  }

  try {
    const result = await fulfillStripeCheckoutAttempt(supabase, {
      attempt: refreshed.attempt,
      session,
      stripe,
    }, env);
    if ("awaitingPayment" in result && result.awaitingPayment) {
      await markStripeCheckoutAttemptAwaitingPayment(supabase, refreshed.attempt.id, {
        reason: readString(result.reason, "payment_not_confirmed"),
      });
      return;
    }
  } catch (error) {
    await markStripeAttemptReconciliationFailure(supabase, refreshed.attempt.id, error);
    throw error;
  }
}

async function handleCheckoutSessionExpired(supabase: SupabaseClient, event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const attemptLookup = await findStripeCheckoutAttemptByStripeSessionId(supabase, session.id);
  if (!attemptLookup.ok) return;

  await supabase
    .from("commercial_stripe_checkout_attempts")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("id", attemptLookup.attempt.id);

  if (attemptLookup.attempt.commercial_checkout_session_id) {
    await supabase
      .from("commercial_checkout_sessions")
      .update({ status: "checkout_expired", updated_at: new Date().toISOString() })
      .eq("id", attemptLookup.attempt.commercial_checkout_session_id);
    await clearCheckoutPendingSignupCredentialIdempotent(
      supabase,
      attemptLookup.attempt.commercial_checkout_session_id,
    );
  }
}

async function handleSubscriptionProjectionEvent(
  supabase: SupabaseClient,
  event: Stripe.Event,
  context: { eventRowId: string },
) {
  const subscription = event.data.object as Stripe.Subscription;
  assertStripeTestLivemode(subscription.livemode);
  const customerId = readString(subscription.customer);
  const { data: profile } = await supabase
    .from("commercial_stripe_billing_profiles")
    .select("client_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle<Row>();

  if (!profile?.client_id) {
    if (event.type === "customer.subscription.deleted") {
      throw new StripeFulfillmentError(
        "stripe_customer_unknown",
        "Stripe customer is not linked to an internal client.",
        false,
      );
    }
    const correlation = await resolveStripeSubscriptionWebhookCorrelation(supabase, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      excludeEventRowId: context.eventRowId,
    });
    if (correlation.action === "reject") {
      throw new StripeFulfillmentError(
        "stripe_customer_unknown",
        "Stripe customer is not linked to an internal client.",
        false,
      );
    }
    await patchStripeWebhookEventMetadata(supabase, context.eventRowId, {
      defer_reason: "awaiting_billing_profile",
      subscription_snapshot: buildStripeSubscriptionSnapshot(subscription),
    });
    throw new StripeFulfillmentError(
      "stripe_customer_pending_link",
      "Stripe customer is not linked to an internal client yet.",
      true,
    );
  }

  await reconcilePaidStripeSubscriptionProjection(supabase, {
    clientId: String(profile.client_id),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    correlationBasis: event.type === "customer.subscription.deleted"
      ? "subscription_deleted_webhook"
      : "subscription_webhook_projection",
    incomingSnapshot: buildStripeSubscriptionSnapshot(subscription),
    incomingIsTerminalEvent: event.type === "customer.subscription.deleted",
  });
}

async function handleInvoiceEvent(supabase: SupabaseClient, event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  assertStripeTestLivemode(invoice.livemode);
  const customerId = readString(invoice.customer);
  const { data: profile } = await supabase
    .from("commercial_stripe_billing_profiles")
    .select("client_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle<Row>();
  if (!profile?.client_id) {
    throw new StripeFulfillmentError("stripe_customer_unknown", "Stripe customer is not linked to an internal client.", false);
  }

  if (event.type === "invoice.paid") {
    return;
  }

  if (event.type === "invoice.payment_failed") {
    await supabase
      .from("commercial_stripe_subscriptions")
      .update({
        status: "past_due",
        updated_at: new Date().toISOString(),
        metadata_safe: { last_invoice_payment_failed: true },
      })
      .eq("client_id", String(profile.client_id));
  }
}

function readObjectId(event: Stripe.Event) {
  const object = event.data.object as { id?: string };
  return readString(object?.id) || null;
}

function readCustomerId(event: Stripe.Event) {
  const object = event.data.object as { customer?: string | Stripe.Customer | null };
  const customer = object.customer;
  return typeof customer === "string" ? customer : readString(customer?.id) || null;
}

function readSubscriptionId(event: Stripe.Event) {
  const object = event.data.object as { subscription?: string | Stripe.Subscription | null; id?: string };
  if (event.type.startsWith("customer.subscription.")) {
    return readString(object.id) || null;
  }
  const subscription = object.subscription;
  return typeof subscription === "string" ? subscription : readString(subscription?.id) || null;
}

function readCheckoutSessionId(event: Stripe.Event) {
  if (!event.type.startsWith("checkout.session.")) return null;
  const object = event.data.object as { id?: string };
  return readString(object.id) || null;
}

export async function verifyStripeSessionStatusOwnership(
  supabase: SupabaseClient,
  input: {
    requesterUserId: string;
    requesterClientId?: string | null;
    isAdmin: boolean;
    internalCheckoutSessionId?: string | null;
    stripeCheckoutSessionId?: string | null;
  },
) {
  if (input.isAdmin) {
    return { ok: true as const };
  }

  if (
    !input.requesterUserId
    && input.stripeCheckoutSessionId
    && !input.internalCheckoutSessionId
  ) {
    const attempt = await findStripeCheckoutAttemptByStripeSessionId(
      supabase,
      input.stripeCheckoutSessionId,
    );
    if (!attempt.ok) {
      return { ok: false as const, code: "session_not_found" as const };
    }
    if (attempt.attempt.flow_type !== "first_purchase") {
      return { ok: false as const, code: "session_forbidden" as const };
    }
    return { ok: true as const, publicPostPaymentPoll: true as const };
  }

  if (!input.requesterUserId) {
    return { ok: false as const, code: "session_forbidden" as const };
  }

  if (input.internalCheckoutSessionId) {
    const { data } = await supabase
      .from("commercial_checkout_sessions")
      .select("auth_user_id,client_id,purchaser_email")
      .eq("id", input.internalCheckoutSessionId)
      .maybeSingle<Row>();
    if (!data?.auth_user_id && !data?.client_id) {
      return { ok: false as const, code: "session_forbidden" as const };
    }
    if (readString(data.auth_user_id) === input.requesterUserId) {
      return { ok: true as const };
    }
    if (input.requesterClientId && readString(data.client_id) === input.requesterClientId) {
      return { ok: true as const };
    }
    return { ok: false as const, code: "session_forbidden" as const };
  }

  if (input.stripeCheckoutSessionId) {
    const attempt = await findStripeCheckoutAttemptByStripeSessionId(supabase, input.stripeCheckoutSessionId);
    if (!attempt.ok) {
      return { ok: false as const, code: "session_not_found" as const };
    }
    if (readString(attempt.attempt.auth_user_id) === input.requesterUserId) {
      return { ok: true as const };
    }
    if (input.requesterClientId && readString(attempt.attempt.client_id) === input.requesterClientId) {
      return { ok: true as const };
    }
    return { ok: false as const, code: "session_forbidden" as const };
  }

  return { ok: false as const, code: "session_required" as const };
}

export async function getSafeStripeSessionStatus(
  supabase: SupabaseClient,
  input: { internalCheckoutSessionId?: string | null; stripeCheckoutSessionId?: string | null },
) {
  if (input.internalCheckoutSessionId) {
    const { data } = await supabase
      .from("commercial_checkout_sessions")
      .select("status,activated_at,auth_user_id")
      .eq("id", input.internalCheckoutSessionId)
      .maybeSingle<Row>();
    if (data?.status) {
      const commercialStatus = readString(data.status);
      const authUserId = readString(data.auth_user_id);
      return {
        ok: true as const,
        commercialStatus,
        activatedAt: readString(data.activated_at) || null,
        readyForLogin: commercialStatus === "checkout_paid" && Boolean(authUserId),
      };
    }
  }
  if (input.stripeCheckoutSessionId) {
    const attempt = await findStripeCheckoutAttemptByStripeSessionId(supabase, input.stripeCheckoutSessionId);
    if (attempt.ok) {
      const commercialStatus = mapAttemptStatusToCommercialStatus(attempt.attempt.status);
      const authUserId = readString(attempt.attempt.auth_user_id);
      return {
        ok: true as const,
        commercialStatus,
        activatedAt: attempt.attempt.fulfilled_at || null,
        readyForLogin: isStripeAttemptFulfilled(attempt.attempt.status) && Boolean(authUserId),
      };
    }
  }
  return { ok: false as const, code: "session_not_found" as const };
}
