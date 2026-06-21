import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRemainingRatioBps,
  buildPlanChangeProrationQuote,
  computeRemainingRatioBps,
  roundPlanChangeCents,
} from "./plan-change-proration.ts";

test("upsell proration: 60% remaining yields 400€ credit, 600€ target remainder, 200€ due", () => {
  const periodStartAt = "2026-01-01T00:00:00.000Z";
  const periodEndAt = "2026-01-01T00:01:40.000Z";
  const effectiveChangeAt = "2026-01-01T00:00:40.000Z";
  assert.equal(computeRemainingRatioBps({ periodStartAt, periodEndAt, effectiveChangeAt }), 6000);

  const quote = buildPlanChangeProrationQuote({
    activeCommercialPeriodValueCents: 60_000,
    targetFullPeriodPriceCents: 90_000,
    periodStartAt,
    periodEndAt,
    effectiveChangeAt,
    existingCustomerCreditCents: 0,
  });

  assert.equal(quote.currentUnusedCreditCents, 36_000);
  assert.equal(quote.targetRemainingCostCents, 54_000);
  assert.equal(quote.amountDueCents, 18_000);
  assert.equal(quote.remainingCreditCents, 0);
});

test("downsell proration: 36k credit against 27k target remainder yields 0 due and 9k remaining credit", () => {
  const periodStartAt = "2026-01-01T00:00:00.000Z";
  const periodEndAt = "2026-01-01T00:01:40.000Z";
  const effectiveChangeAt = "2026-01-01T00:00:40.000Z";

  const quote = buildPlanChangeProrationQuote({
    activeCommercialPeriodValueCents: 60_000,
    targetFullPeriodPriceCents: 45_000,
    periodStartAt,
    periodEndAt,
    effectiveChangeAt,
    existingCustomerCreditCents: 0,
  });

  assert.equal(quote.currentUnusedCreditCents, 36_000);
  assert.equal(quote.targetRemainingCostCents, 27_000);
  assert.equal(quote.amountDueCents, 0);
  assert.equal(quote.remainingCreditCents, 9_000);
});

test("existing customer credit is applied once in available credit and final due", () => {
  const quote = buildPlanChangeProrationQuote({
    activeCommercialPeriodValueCents: 60_000,
    targetFullPeriodPriceCents: 90_000,
    periodStartAt: "2026-01-01T00:00:00.000Z",
    periodEndAt: "2026-01-01T00:01:40.000Z",
    effectiveChangeAt: "2026-01-01T00:00:40.000Z",
    existingCustomerCreditCents: 5_000,
  });

  assert.equal(quote.availableCreditCents, 41_000);
  assert.equal(quote.amountDueCents, 13_000);
  assert.equal(quote.remainingCreditCents, 0);
});

test("rounding stays in integer cents without floats leaking", () => {
  assert.equal(roundPlanChangeCents(10.4), 10);
  assert.equal(roundPlanChangeCents(10.5), 11);
  assert.equal(applyRemainingRatioBps(10_001, 3333), 3333);
});

test("expired period yields zero remaining ratio", () => {
  const ratio = computeRemainingRatioBps({
    periodStartAt: "2026-01-01T00:00:00.000Z",
    periodEndAt: "2026-04-01T00:00:00.000Z",
    effectiveChangeAt: "2026-05-01T00:00:00.000Z",
  });
  assert.equal(ratio, 0);
});
