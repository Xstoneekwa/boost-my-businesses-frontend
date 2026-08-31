import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveStripePlanChangeFinancialActual,
  stripeCreditSnapshotMatchesQuote,
} from "./stripe-plan-change-financial-actual.ts";

const subscriptionId = "sub_current";
const mutationUnix = 1_788_126_434;

function line(overrides = {}) {
  return {
    id: "ii_default",
    amount: 0,
    currency: "eur",
    created: mutationUnix,
    proration: true,
    subscriptionId,
    ...overrides,
  };
}

test("pending invoice items are the exact post-mutation source for zero due plus credit", () => {
  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    pendingInvoiceItems: [
      line({ id: "ii_premium_credit", amount: -66_607 }),
      line({ id: "ii_growth_cost", amount: 39_640 }),
    ],
    customerBalanceBeforeCents: 0,
    customerBalanceAfterCents: 0,
    reconciledAt: "2026-08-30T21:47:18.648Z",
  });
  assert.deepEqual(actual, {
    source: "pending_invoice_items",
    currency: "EUR",
    amountDueCents: 0,
    remainingCreditCents: 26_967,
    signedProrationNetCents: -26_967,
    sourceObjectIds: ["ii_growth_cost", "ii_premium_credit"],
    reconciledAt: "2026-08-30T21:47:18.648Z",
  });
});

test("Stripe actual wins even when the local estimate differs by seconds", () => {
  const quotedCreditCents = 26_976;
  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    pendingInvoiceItems: [
      line({ id: "credit", amount: -66_607 }),
      line({ id: "cost", amount: 39_640 }),
    ],
  });
  assert.equal(quotedCreditCents, 26_976);
  assert.equal(actual?.remainingCreditCents, 26_967);
  assert.notEqual(actual?.remainingCreditCents, quotedCreditCents);
});

test("a finalized invoice is canonical after pending invoice items are consumed", () => {
  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    finalizedInvoiceLines: [
      line({ id: "il_credit", amount: -12_345 }),
      line({ id: "il_cost", amount: 9_000 }),
    ],
  });
  assert.equal(actual?.source, "finalized_invoice");
  assert.equal(actual?.remainingCreditCents, 3_345);
  assert.equal(actual?.amountDueCents, 0);
});

test("customer balance requires an observed delta and is never inferred from a static balance", () => {
  assert.equal(resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    customerBalanceBeforeCents: -1_000,
    customerBalanceAfterCents: -1_000,
  }), null);

  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    customerBalanceBeforeCents: 0,
    customerBalanceAfterCents: -5_000,
  });
  assert.equal(actual?.source, "customer_balance");
  assert.equal(actual?.remainingCreditCents, 5_000);
});

test("foreign, non-proration and non-EUR lines cannot contaminate the actual", () => {
  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    pendingInvoiceItems: [
      line({ id: "foreign", amount: -99_999, subscriptionId: "sub_other" }),
      line({ id: "non_proration", amount: -99_999, proration: false }),
      line({ id: "usd", amount: -99_999, currency: "usd" }),
      line({ id: "current_credit", amount: -10_000 }),
      line({ id: "current_cost", amount: 8_000 }),
    ],
  });
  assert.equal(actual?.remainingCreditCents, 2_000);
  assert.deepEqual(actual?.sourceObjectIds, ["current_cost", "current_credit"]);
});

test("successive pending plan changes preserve the complete not-yet-invoiced Stripe credit", () => {
  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    pendingInvoiceItems: [
      line({ id: "previous_credit", amount: -40_000, created: mutationUnix - 120 }),
      line({ id: "previous_cost", amount: 20_000, created: mutationUnix - 120 }),
      line({ id: "current_credit", amount: -15_000, created: mutationUnix }),
      line({ id: "current_cost", amount: 10_000, created: mutationUnix }),
    ],
  });
  assert.equal(actual?.remainingCreditCents, 25_000);
  assert.deepEqual(actual?.sourceObjectIds, ["current_cost", "current_credit", "previous_cost", "previous_credit"]);
});

test("duplicate reconciliation is deterministic and does not duplicate credit", () => {
  const input = {
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    pendingInvoiceItems: [line({ id: "a", amount: -4_000 }), line({ id: "b", amount: 1_000 })],
    reconciledAt: "2026-08-30T21:47:18.648Z",
  };
  assert.deepEqual(
    resolveStripePlanChangeFinancialActual(input),
    resolveStripePlanChangeFinancialActual(input),
  );
});

test("current-credit mode validates the complete Stripe pending state before confirmation", () => {
  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    snapshotMode: "current_credit",
    pendingInvoiceItems: [
      line({ id: "premium_unused", amount: -66_607, created: mutationUnix - 86_400 }),
      line({ id: "growth_remaining", amount: 39_640, created: mutationUnix - 86_400 }),
    ],
  });
  assert.equal(actual?.remainingCreditCents, 26_967);
  assert.equal(stripeCreditSnapshotMatchesQuote(26_967, actual), true);
  assert.equal(stripeCreditSnapshotMatchesQuote(26_976, actual), false);
});

test("production-derived Growth to Pro pending items converge to exact 13585 cents", () => {
  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    pendingInvoiceItems: [
      line({ id: "prior_premium_unused", amount: -66_607, created: mutationUnix - 120 }),
      line({ id: "prior_growth_remaining", amount: 39_640, created: mutationUnix - 120 }),
      line({ id: "current_growth_unused", amount: -39_343 }),
      line({ id: "current_pro_remaining", amount: 52_725 }),
    ],
    reconciledAt: "2026-08-31T14:20:00.896Z",
  });
  assert.equal(actual?.source, "pending_invoice_items");
  assert.equal(actual?.remainingCreditCents, 13_585);
  assert.equal(actual?.signedProrationNetCents, -13_585);
});

test("current-credit customer-balance fallback is exact and never tolerant", () => {
  const actual = resolveStripePlanChangeFinancialActual({
    stripeSubscriptionId: subscriptionId,
    mutationUnix,
    snapshotMode: "current_credit",
    customerBalanceAfterCents: -13_585,
  });
  assert.equal(actual?.source, "customer_balance");
  assert.equal(actual?.remainingCreditCents, 13_585);
  assert.equal(stripeCreditSnapshotMatchesQuote(13_585, actual), true);
  assert.equal(stripeCreditSnapshotMatchesQuote(13_586, actual), false);
});
