import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanChangeProrationQuote } from "./plan-change-proration.ts";
import { resolveActiveCommercialPeriodValueCents } from "./plan-change-commercial-value.ts";

test("successive plan change uses full commercial value 900€ not 200€ cash for second proration", () => {
  const periodStartAt = "2026-01-01T00:00:00.000Z";
  const periodEndAt = "2026-04-01T00:00:00.000Z";

  const firstChangeAt = "2026-02-01T00:00:00.000Z";
  const firstChange = buildPlanChangeProrationQuote({
    activeCommercialPeriodValueCents: 60_000,
    targetFullPeriodPriceCents: 90_000,
    periodStartAt,
    periodEndAt,
    effectiveChangeAt: firstChangeAt,
    existingCustomerCreditCents: 0,
  });

  assert.ok(firstChange.currentUnusedCreditCents >= 39_000);
  assert.ok(firstChange.currentUnusedCreditCents <= 41_000);
  assert.ok(firstChange.targetRemainingCostCents >= 59_000);
  assert.ok(firstChange.amountDueCents >= 19_000);

  const postUpsellSession = {
    flow_type: "plan_change",
    total_period_cents: firstChange.amountDueCents,
    pack_period_total_cents: 90_000,
    metadata: {
      commercial_period_value_cents: 90_000,
      cash_collected_cents: firstChange.amountDueCents,
    },
  };
  const postUpsellEntitlement = { pack_period_total_cents: 90_000 };

  const commercialAfterUpsell = resolveActiveCommercialPeriodValueCents({
    session: postUpsellSession,
    entitlement: postUpsellEntitlement,
  });
  assert.equal(commercialAfterUpsell, 90_000);

  const secondChangeAt = "2026-03-01T00:00:00.000Z";
  const secondChange = buildPlanChangeProrationQuote({
    activeCommercialPeriodValueCents: commercialAfterUpsell,
    targetFullPeriodPriceCents: 45_000,
    periodStartAt,
    periodEndAt,
    effectiveChangeAt: secondChangeAt,
    existingCustomerCreditCents: 0,
  });

  assert.notEqual(secondChange.currentUnusedCreditCents, 10_000);
  assert.ok(secondChange.currentUnusedCreditCents >= 29_000);
  assert.ok(secondChange.currentUnusedCreditCents <= 31_000);
  assert.notEqual(
    secondChange.currentUnusedCreditCents,
    Math.round(firstChange.amountDueCents * secondChange.remainingRatioBps / 10_000),
  );
});
