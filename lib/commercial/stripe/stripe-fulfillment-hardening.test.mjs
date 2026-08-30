import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  validatePlanChangeCheckoutPayment,
  validateSubscriptionCheckoutPayment,
} from "./stripe-payment-confirmation.ts";
import {
  resolveWebhookClaimDecision,
  STRIPE_WEBHOOK_PROCESSING_STALE_MS,
} from "./stripe-webhook-claim.ts";
import {
  isStripeAttemptFulfilled,
  isStripeAttemptRecoverable,
  mapAttemptStatusToCommercialStatus,
  STRIPE_ATTEMPT_STATUS,
} from "./stripe-attempt-state.ts";
import { canResumeStripeAttemptFulfillment } from "./stripe-checkout-attempts.ts";

describe("subscription payment confirmation fail-closed", () => {
  it("rejects checkout.session.completed with unpaid payment_status", () => {
    const result = validateSubscriptionCheckoutPayment({
      session: { mode: "subscription", payment_status: "unpaid", status: "complete" },
      subscription: { id: "sub_123", status: "active" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "payment_not_confirmed");
  });

  it("rejects incomplete subscription status", () => {
    const result = validateSubscriptionCheckoutPayment({
      session: { mode: "subscription", payment_status: "paid", status: "complete" },
      subscription: { id: "sub_123", status: "incomplete" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "subscription_not_active");
  });

  it("accepts paid subscription checkout", () => {
    const result = validateSubscriptionCheckoutPayment({
      session: { mode: "subscription", payment_status: "paid", status: "complete" },
      subscription: { id: "sub_123", status: "active" },
    });
    assert.equal(result.ok, true);
  });
});

describe("plan change payment confirmation fail-closed", () => {
  it("rejects unpaid one-off checkout", () => {
    const result = validatePlanChangeCheckoutPayment({
      session: { mode: "payment", payment_status: "unpaid" },
      paymentIntent: { status: "requires_payment_method" },
    });
    assert.equal(result.ok, false);
  });

  it("rejects payment intent not succeeded when present", () => {
    const result = validatePlanChangeCheckoutPayment({
      session: { mode: "payment", payment_status: "paid" },
      paymentIntent: { status: "processing" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "payment_intent_not_succeeded");
  });

  it("accepts paid one-off checkout", () => {
    const result = validatePlanChangeCheckoutPayment({
      session: { mode: "payment", payment_status: "paid" },
      paymentIntent: { status: "succeeded" },
    });
    assert.equal(result.ok, true);
  });
});

describe("webhook ledger claim decisions", () => {
  it("deduplicates processed events", () => {
    const decision = resolveWebhookClaimDecision(
      { status: "processed", processingStartedAtMs: Date.now() },
      Date.now(),
    );
    assert.equal(decision.action, "deduplicated");
  });

  it("allows reclaim for failed events", () => {
    const decision = resolveWebhookClaimDecision(
      { status: "failed", processingStartedAtMs: Date.now() - 1000 },
      Date.now(),
    );
    assert.equal(decision.action, "claim");
  });

  it("allows reclaim for retryable events", () => {
    const decision = resolveWebhookClaimDecision(
      { status: "retryable", processingStartedAtMs: Date.now() - 1000 },
      Date.now(),
    );
    assert.equal(decision.action, "claim");
  });

  it("returns concurrent retry for fresh processing lease", () => {
    const decision = resolveWebhookClaimDecision(
      { status: "processing", processingStartedAtMs: Date.now() },
      Date.now(),
      STRIPE_WEBHOOK_PROCESSING_STALE_MS,
    );
    assert.equal(decision.action, "concurrent_retry");
  });

  it("reclaims stale processing lease", () => {
    const decision = resolveWebhookClaimDecision(
      { status: "processing", processingStartedAtMs: Date.now() - STRIPE_WEBHOOK_PROCESSING_STALE_MS - 1 },
      Date.now(),
      STRIPE_WEBHOOK_PROCESSING_STALE_MS,
    );
    assert.equal(decision.action, "reclaim_stale");
  });
});

describe("attempt state machine", () => {
  it("does not treat payment_confirmed as fulfilled", () => {
    assert.equal(isStripeAttemptFulfilled(STRIPE_ATTEMPT_STATUS.PAYMENT_CONFIRMED), false);
    assert.equal(isStripeAttemptRecoverable(STRIPE_ATTEMPT_STATUS.PAYMENT_CONFIRMED), true);
  });

  it("maps reconciliation_required to pending fulfillment commercial status", () => {
    assert.equal(
      mapAttemptStatusToCommercialStatus(STRIPE_ATTEMPT_STATUS.RECONCILIATION_REQUIRED),
      "checkout_paid_pending_fulfillment",
    );
  });

  it("allows recovery only for paid recoverable attempts", () => {
    const recoverable = canResumeStripeAttemptFulfillment({
      id: "a1",
      status: STRIPE_ATTEMPT_STATUS.RECONCILIATION_REQUIRED,
    });
    assert.equal(recoverable.ok, true);
    assert.equal(recoverable.alreadyFulfilled, false);

    const blocked = canResumeStripeAttemptFulfillment({
      id: "a2",
      status: STRIPE_ATTEMPT_STATUS.SESSION_CREATED,
    });
    assert.equal(blocked.ok, false);
  });
});

describe("plan change checkout creation guards", () => {
  it("requires subscription and target price before checkout in source", () => {
    const source = readFileSync(new URL("./stripe-plan-change-checkout.ts", import.meta.url), "utf8");
    assert.match(source, /stripe_subscription_missing/);
    assert.match(source, /stripe_price_mapping_missing/);
    assert.match(source, /targetStripePriceId/);
    assert.match(source, /stripeSubscriptionId/);
  });

  it("fulfillment applies Stripe price but defers local activation to canonical subscription webhook", () => {
    const source = readFileSync(new URL("./stripe-fulfillment.ts", import.meta.url), "utf8");
    const planChangeBlock = source.slice(source.indexOf("async function fulfillPlanChangeAttempt"));
    const syncIndex = planChangeBlock.indexOf("syncStripeSubscriptionPriceAfterPlanChangePayment");
    const markFulfilledIndex = planChangeBlock.indexOf("markStripeCheckoutAttemptFulfilled");
    assert.ok(syncIndex >= 0 && markFulfilledIndex > syncIndex);
    assert.doesNotMatch(planChangeBlock, /activatePlanChangeQuote/);
    assert.match(planChangeBlock, /stripe_price_applied_awaiting_webhook/);
    assert.match(source, /target_price_missing/);
    assert.match(source, /stripe_subscription_sync_failed/);
  });
});

describe("session-status ownership and public preservation", () => {
  it("session-status route enforces ownership before returning status", () => {
    const source = readFileSync(
      new URL("../../../app/api/commercial/checkout/stripe/session-status/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /verifyStripeSessionStatusOwnership/);
    assert.match(source, /ownership\.code/);
    assert.doesNotMatch(source, /stripe_customer_id/);
    assert.doesNotMatch(source, /payment_intent/);
  });

  it("success page polls activation then redirects to login without browser activation", () => {
    const source = readFileSync(new URL("../../../app/commercial/stripe-test/success/page.tsx", import.meta.url), "utf8");
    assert.match(source, /session-status/);
    assert.match(source, /router\.replace\(destination \|\| loginPath\)/);
    assert.match(source, /ready_for_handoff/);
    assert.doesNotMatch(source, /activateClientAccountEntitlementFromCheckout|create-session|informational only/i);
  });

  it("CommercialCheckoutForm keeps simulation mode and adds public Stripe Test session mode", () => {
    const source = readFileSync(new URL("../../../app/instagram-growth/checkout/CommercialCheckoutForm.tsx", import.meta.url), "utf8");
    assert.match(source, /\/api\/commercial\/checkout\/simulated\/activate/);
    assert.match(source, /\/api\/commercial\/checkout\/stripe\/create-session/);
    assert.match(source, /password_confirmation/);
    assert.match(source, /resolvePublicCheckoutSelection/);
    assert.doesNotMatch(source, /price_id|stripe_price_id|success_url|cancel_url/);
  });

  it("admin recovery route is admin-only and does not create checkout", () => {
    const source = readFileSync(
      new URL("../../../app/api/instagram-dashboard/commercial/stripe-test/recover-fulfillment/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /requireInstagramAdmin/);
    assert.match(source, /recoverStripeCheckoutAttemptFulfillment/);
    assert.doesNotMatch(source, /checkout\.sessions\.create/);
  });
});

describe("webhook handler hardening markers", () => {
  it("marks retryable failures and validates payment before fulfillment", () => {
    const source = readFileSync(new URL("./stripe-webhook-handler.ts", import.meta.url), "utf8");
    assert.match(source, /ALLOWED_STRIPE_WEBHOOK_EVENTS/);
    assert.match(source, /stripe_event_type_not_allowed/);
    assert.match(source, /validateSubscriptionCheckoutPayment/);
    assert.match(source, /validatePlanChangeCheckoutPayment/);
    assert.match(source, /retryable/);
    assert.match(source, /markStripeCheckoutAttemptAwaitingPayment/);
    assert.doesNotMatch(source, /markStripeCheckoutAttemptCompleted/);
  });
});
