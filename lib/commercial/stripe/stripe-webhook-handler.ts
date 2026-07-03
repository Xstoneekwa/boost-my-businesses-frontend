import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { activateClientAccountEntitlementFromCheckout } from "../activate-client-account-entitlement-from-checkout.ts";
import { activatePlanChangeQuote } from "../plan-change-quote.ts";
import { beginStripeWebhookEvent, finishStripeWebhookEvent } from "./stripe-webhook-ledger.ts";
import {
  findStripeCheckoutAttemptByStripeSessionId,
  markCommercialCheckoutSessionPaid,
  markStripeCheckoutAttemptCompleted,
} from "./stripe-checkout-attempts.ts";
import { syncStripeSubscriptionPriceAfterPlanChangePayment } from "./stripe-plan-change-checkout.ts";
import { upsertStripeBillingProfile, upsertStripeSubscriptionProjection } from "./stripe-subscription-projection.ts";
import { assertStripeTestLivemode, requireStripeTestConfig } from "./stripe-config.ts";
import { getStripeClient } from "./stripe-client.ts";

type Row = Record<string, unknown>;

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
) {
  const ledger = await beginStripeWebhookEvent(supabase, {
    stripeEventId: event.id,
    eventType: event.type,
    livemode: event.livemode,
    stripeObjectId: readObjectId(event),
    stripeCustomerId: readCustomerId(event),
    stripeSubscriptionId: readSubscriptionId(event),
    stripeCheckoutSessionId: readCheckoutSessionId(event),
    metadataSafe: { type: event.type },
  });

  if (!ledger.ok) {
    return { ok: false as const, status: 503, code: ledger.code };
  }
  if (ledger.deduplicated) {
    return { ok: true as const, status: 200, deduplicated: true as const };
  }
  if (!ledger.eventRowId) {
    return { ok: true as const, status: 200, deduplicated: true as const };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(supabase, event);
        break;
      case "checkout.session.expired":
        await handleCheckoutSessionExpired(supabase, event);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionProjectionEvent(supabase, event);
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
        await handleInvoiceEvent(supabase, event);
        break;
      default:
        await finishStripeWebhookEvent(supabase, {
          eventRowId: ledger.eventRowId,
          status: "ignored",
        });
        return { ok: true as const, status: 200, ignored: true as const };
    }

    await finishStripeWebhookEvent(supabase, {
      eventRowId: ledger.eventRowId,
      status: "processed",
    });
    return { ok: true as const, status: 200, processed: true as const };
  } catch (error) {
    await finishStripeWebhookEvent(supabase, {
      eventRowId: ledger.eventRowId,
      status: "failed",
      errorRedacted: error instanceof Error ? error.message.slice(0, 200) : "handler_failed",
    });
    return { ok: false as const, status: 500, code: "webhook_handler_failed" as const };
  }
}

async function handleCheckoutSessionCompleted(supabase: SupabaseClient, event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  assertStripeTestLivemode(session.livemode);

  const attemptLookup = await findStripeCheckoutAttemptByStripeSessionId(supabase, session.id);
  if (!attemptLookup.ok) {
    return;
  }
  const attempt = attemptLookup.attempt;

  if (attempt.status === "completed") {
    return;
  }

  await markStripeCheckoutAttemptCompleted(supabase, attempt.id, {
    stripeSubscriptionId: readString(session.subscription),
    stripePaymentIntentId: readString(session.payment_intent),
    stripeCustomerId: readString(session.customer),
  });

  if (attempt.checkout_mode === "subscription" && attempt.commercial_checkout_session_id) {
    await markCommercialCheckoutSessionPaid(supabase, attempt.commercial_checkout_session_id);

    const { data: checkoutSession } = await supabase
      .from("commercial_checkout_sessions")
      .select("*")
      .eq("id", attempt.commercial_checkout_session_id)
      .maybeSingle<Row>();

    if (!checkoutSession?.id) {
      return;
    }

    await activateClientAccountEntitlementFromCheckout(supabase, {
      planKey: readString(checkoutSession.plan_key),
      billingIntervalMonths: Number(checkoutSession.billing_interval_months ?? 1),
      outreachAddonKey: readString(checkoutSession.outreach_addon_key) || null,
      purchaserEmail: readString(checkoutSession.purchaser_email),
      idempotencyKey: readString(checkoutSession.idempotency_key),
      flowType: readString(checkoutSession.flow_type) === "additional_account" ? "additional_account" : "first_purchase",
      clientId: readString(checkoutSession.client_id) || attempt.client_id,
      authUserId: readString(checkoutSession.auth_user_id) || attempt.auth_user_id,
      mode: "stripe",
      stripeWebhookConfirmed: true,
      precreatedCheckoutSessionId: readString(checkoutSession.id),
    });
  }

  if (attempt.checkout_mode === "payment" && attempt.plan_change_quote_id) {
    const quoteId = attempt.plan_change_quote_id;
    const stripe = getStripeClient();
    const customerId = readString(session.customer);
    const { data: billingProfile } = await supabase
      .from("commercial_stripe_billing_profiles")
      .select("client_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle<Row>();

    const { data: subscriptionRow } = billingProfile?.client_id
      ? await supabase
        .from("commercial_stripe_subscriptions")
        .select("stripe_subscription_id")
        .eq("client_id", String(billingProfile.client_id))
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<Row>()
      : { data: null };

    const stripeSubscriptionId = readString(subscriptionRow?.stripe_subscription_id);
    const { data: quoteRow } = await supabase
      .from("commercial_plan_change_quotes")
      .select("target_plan_key,billing_interval_months,source_revision,idempotency_key,client_id")
      .eq("id", quoteId)
      .maybeSingle<Row>();

    if (stripeSubscriptionId && quoteRow) {
      const { resolveServerStripePriceId } = await import("./stripe-price-resolver.ts");
      const targetPriceId = await resolveServerStripePriceId(supabase, {
        environment: "test",
        planKey: readString(quoteRow.target_plan_key) as "growth" | "pro" | "premium",
        billingIntervalMonths: Number(quoteRow.billing_interval_months ?? 1) as 1 | 3 | 6 | 12,
        outreachAddonKey: null,
      });
      if (targetPriceId) {
        const sync = await syncStripeSubscriptionPriceAfterPlanChangePayment(stripe, {
          stripeSubscriptionId,
          targetPriceId,
        });
        if (!sync.ok) {
          throw new Error("stripe_subscription_sync_failed");
        }
      }
    }

    await supabase
      .from("commercial_plan_change_quotes")
      .update({
        payment_status: "confirmed",
        payment_provider: "stripe",
        provider_transaction_id: readString(session.payment_intent) || session.id,
        payment_confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId);

    await activatePlanChangeQuote(supabase, {
      quoteId,
      idempotencyKey: readString(quoteRow?.idempotency_key) || attempt.idempotency_key,
      actorEmail: attempt.purchaser_email,
      simulatedActivation: false,
    });
  }

  if (readString(session.customer)) {
    await upsertStripeBillingProfile(supabase, {
      clientId: attempt.client_id,
      stripeCustomerId: readString(session.customer),
      billingEmail: attempt.purchaser_email,
    });
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
  }
}

async function handleSubscriptionProjectionEvent(supabase: SupabaseClient, event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  assertStripeTestLivemode(subscription.livemode);
  const customerId = readString(subscription.customer);
  const { data: profile } = await supabase
    .from("commercial_stripe_billing_profiles")
    .select("client_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle<Row>();

  if (!profile?.client_id) return;

  await upsertStripeSubscriptionProjection(supabase, {
    clientId: String(profile.client_id),
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    stripePriceId: subscription.items.data[0]?.price?.id ?? null,
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString()
      : null,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}

async function handleInvoiceEvent(supabase: SupabaseClient, event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  assertStripeTestLivemode(invoice.livemode);
  if (event.type === "invoice.payment_failed") {
    const customerId = readString(invoice.customer);
    const { data: profile } = await supabase
      .from("commercial_stripe_billing_profiles")
      .select("client_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle<Row>();
    if (profile?.client_id) {
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

export async function getSafeStripeSessionStatus(
  supabase: SupabaseClient,
  input: { internalCheckoutSessionId?: string | null; stripeCheckoutSessionId?: string | null },
) {
  if (input.internalCheckoutSessionId) {
    const { data } = await supabase
      .from("commercial_checkout_sessions")
      .select("status,activated_at")
      .eq("id", input.internalCheckoutSessionId)
      .maybeSingle<Row>();
    if (data?.status) {
      return {
        ok: true as const,
        commercialStatus: readString(data.status),
        activatedAt: readString(data.activated_at) || null,
      };
    }
  }
  if (input.stripeCheckoutSessionId) {
    const attempt = await findStripeCheckoutAttemptByStripeSessionId(supabase, input.stripeCheckoutSessionId);
    if (attempt.ok) {
      return {
        ok: true as const,
        commercialStatus: attempt.attempt.status === "completed" ? "checkout_paid" : "checkout_pending_payment",
        activatedAt: null,
      };
    }
  }
  return { ok: false as const, code: "session_not_found" as const };
}
