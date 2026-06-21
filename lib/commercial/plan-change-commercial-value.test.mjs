import assert from "node:assert/strict";
import test from "node:test";
import { resolveActiveCommercialPeriodValueCents, resolveCashCollectedCents } from "./plan-change-commercial-value.ts";

test("first_purchase uses total_period_cents as commercial value when pack total absent", () => {
  const value = resolveActiveCommercialPeriodValueCents({
    session: { flow_type: "first_purchase", total_period_cents: 60_000 },
    entitlement: {},
  });
  assert.equal(value, 60_000);
});

test("plan_change never uses cash collected as commercial proration base", () => {
  const value = resolveActiveCommercialPeriodValueCents({
    session: {
      flow_type: "plan_change",
      total_period_cents: 20_000,
      pack_period_total_cents: 90_000,
      metadata: { cash_collected_cents: 20_000, amount_due_cents: 20_000 },
    },
    entitlement: { pack_period_total_cents: 90_000 },
  });
  assert.equal(value, 90_000);
  assert.notEqual(value, 20_000);
});

test("plan_change without commercial value is ambiguous", () => {
  const value = resolveActiveCommercialPeriodValueCents({
    session: { flow_type: "plan_change", total_period_cents: 20_000 },
    entitlement: {},
  });
  assert.equal(value, null);
});

test("cash collected is tracked separately from commercial value", () => {
  const cash = resolveCashCollectedCents({
    flow_type: "plan_change",
    total_period_cents: 20_000,
    metadata: { amount_due_cents: 20_000 },
  });
  assert.equal(cash, 20_000);
});
