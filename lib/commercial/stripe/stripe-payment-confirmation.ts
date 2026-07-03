import type Stripe from "stripe";

export type SubscriptionPaymentValidation =
  | { ok: true; subscriptionId: string; subscriptionStatus: string }
  | { ok: false; code: "payment_not_confirmed" | "subscription_missing" | "subscription_not_active"; reason: string };

export type PlanChangePaymentValidation =
  | { ok: true; paymentIntentStatus: string | null }
  | { ok: false; code: "payment_not_confirmed" | "payment_intent_not_succeeded"; reason: string };

const PAID_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export function isStripeCheckoutPaymentConfirmed(paymentStatus: string | null | undefined) {
  return paymentStatus === "paid";
}

export function validateSubscriptionCheckoutPayment(input: {
  session: Pick<Stripe.Checkout.Session, "payment_status" | "status" | "mode">;
  subscription: Pick<Stripe.Subscription, "id" | "status"> | null;
}): SubscriptionPaymentValidation {
  if (input.session.mode !== "subscription") {
    return { ok: false, code: "payment_not_confirmed", reason: "unexpected_checkout_mode" };
  }

  if (!isStripeCheckoutPaymentConfirmed(input.session.payment_status)) {
    return {
      ok: false,
      code: "payment_not_confirmed",
      reason: `payment_status_${String(input.session.payment_status ?? "missing")}`,
    };
  }

  const subscriptionId = input.subscription?.id?.trim() ?? "";
  if (!subscriptionId) {
    return { ok: false, code: "subscription_missing", reason: "subscription_id_missing" };
  }

  const subscriptionStatus = String(input.subscription?.status ?? "");
  if (!PAID_SUBSCRIPTION_STATUSES.has(subscriptionStatus)) {
    return {
      ok: false,
      code: "subscription_not_active",
      reason: `subscription_status_${subscriptionStatus || "missing"}`,
    };
  }

  return { ok: true, subscriptionId, subscriptionStatus };
}

export function validatePlanChangeCheckoutPayment(input: {
  session: Pick<Stripe.Checkout.Session, "payment_status" | "mode">;
  paymentIntent: Pick<Stripe.PaymentIntent, "status"> | null;
}): PlanChangePaymentValidation {
  if (input.session.mode !== "payment") {
    return { ok: false, code: "payment_not_confirmed", reason: "unexpected_checkout_mode" };
  }

  if (!isStripeCheckoutPaymentConfirmed(input.session.payment_status)) {
    return {
      ok: false,
      code: "payment_not_confirmed",
      reason: `payment_status_${String(input.session.payment_status ?? "missing")}`,
    };
  }

  const paymentIntentStatus = input.paymentIntent?.status ?? null;
  if (paymentIntentStatus && paymentIntentStatus !== "succeeded") {
    return {
      ok: false,
      code: "payment_intent_not_succeeded",
      reason: `payment_intent_status_${paymentIntentStatus}`,
    };
  }

  return { ok: true, paymentIntentStatus };
}
