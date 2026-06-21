import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePlanChangeActivation } from "./plan-change-activation-guard.ts";

const TEST_ENV = {
  SIMULATED_CHECKOUT_ENABLED: "true",
  SIMULATED_PLAN_CHANGE_ACTIVATION_ENABLED: "true",
  SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: "test@example.com",
  NODE_ENV: "development",
};

test("amount due blocks activation in production without payment confirmation", () => {
  const result = evaluatePlanChangeActivation({
    amountDueCents: 20_000,
    actorEmail: "test@example.com",
    env: { ...TEST_ENV, NODE_ENV: "production", SIMULATED_CHECKOUT_ALLOW_PRODUCTION: "false" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "payment_required");
});

test("amount due allows simulated activation only in allowlisted dev/test", () => {
  const result = evaluatePlanChangeActivation({
    amountDueCents: 20_000,
    actorEmail: "test@example.com",
    env: TEST_ENV,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.mode, "simulated_test");
});

test("zero due activation does not require payment", () => {
  const result = evaluatePlanChangeActivation({
    amountDueCents: 0,
    actorEmail: "anyone@example.com",
    env: { NODE_ENV: "production" },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.mode, "zero_due");
});

test("confirmed payment status allows paid activation path", () => {
  const result = evaluatePlanChangeActivation({
    amountDueCents: 20_000,
    actorEmail: "buyer@example.com",
    paymentStatus: "confirmed",
    env: { NODE_ENV: "production" },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.mode, "payment_confirmed");
});
