import assert from "node:assert/strict";
import test from "node:test";

import { confirmCommercialPayment } from "./confirm-commercial-payment.ts";
import { INITIAL_CHECKOUT_ISOLATED_TEST_CONFIRM_VALUE } from "./initial-checkout-simulation-guard.ts";
import { ISOLATED_CHECKOUT_ALLOWED_REF } from "./server-supabase-ref.ts";
import { withInitialCheckoutAllowlist } from "./initial-checkout-test-env.ts";

const ALLOWED_EMAIL = "initial_checkout_test@example.invalid";
const BASE_ENV = withInitialCheckoutAllowlist([ALLOWED_EMAIL]);

test("confirmCommercialPayment accepts simulated initial checkout when all guards pass", () => {
  const result = confirmCommercialPayment({
    provider: "simulated",
    purchaserEmail: ALLOWED_EMAIL,
    amountDueCents: 19_700,
    idempotencyKey: "idem-allowed-1",
    checkoutContext: "public_new_workspace",
    env: BASE_ENV,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.paymentProvider, "simulated");
    assert.equal(result.paymentStatus, "simulated_confirmed");
    assert.equal(result.idempotencyKey, "idem-allowed-1");
  }
});

test("confirmCommercialPayment rejects wrong server ref", () => {
  const result = confirmCommercialPayment({
    provider: "simulated",
    purchaserEmail: ALLOWED_EMAIL,
    amountDueCents: 19_700,
    idempotencyKey: "idem-ref",
    checkoutContext: "public_new_workspace",
    env: {
      ...BASE_ENV,
      SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "simulated_checkout_forbidden");
    assert.equal(result.reason, "isolated_ref_required");
  }
});

test("confirmCommercialPayment rejects missing isolated test confirm", () => {
  const result = confirmCommercialPayment({
    provider: "simulated",
    purchaserEmail: ALLOWED_EMAIL,
    amountDueCents: 19_700,
    idempotencyKey: "idem-confirm",
    checkoutContext: "public_new_workspace",
    env: {
      ...BASE_ENV,
      SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM: "",
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "simulated_checkout_forbidden");
    assert.equal(result.reason, "isolated_test_confirm_required");
  }
});

test("confirmCommercialPayment rejects non-fictional email", () => {
  const result = confirmCommercialPayment({
    provider: "simulated",
    purchaserEmail: "real.user@company.com",
    amountDueCents: 19_700,
    idempotencyKey: "idem-email",
    checkoutContext: "public_new_workspace",
    env: BASE_ENV,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "simulated_checkout_forbidden");
    assert.equal(result.reason, "fictional_email_required");
  }
});

test("confirmCommercialPayment rejects non-allowlisted fictional email", () => {
  const result = confirmCommercialPayment({
    provider: "simulated",
    purchaserEmail: "initial_checkout_payment@example.invalid",
    amountDueCents: 19_700,
    idempotencyKey: "idem-probe",
    checkoutContext: "public_new_workspace",
    env: BASE_ENV,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "simulation_unavailable");
    assert.equal(result.reason, "simulated_checkout_email_not_allowlisted");
  }
});

test("confirmCommercialPayment rejects paddle provider as not configured", () => {
  const result = confirmCommercialPayment({
    provider: "paddle",
    purchaserEmail: ALLOWED_EMAIL,
    amountDueCents: 19_700,
    idempotencyKey: "idem-paddle",
    checkoutContext: "public_new_workspace",
    env: BASE_ENV,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "provider_not_configured");
  }
});

test("confirmCommercialPayment never returns password fields", () => {
  const serialized = JSON.stringify(
    confirmCommercialPayment({
      provider: "simulated",
      purchaserEmail: ALLOWED_EMAIL,
      amountDueCents: 19_700,
      idempotencyKey: "idem-safe",
      checkoutContext: "public_new_workspace",
      env: BASE_ENV,
    }),
  );
  assert.equal(serialized.includes("password"), false);
});

test("isolated checkout constants stay stable", () => {
  assert.equal(ISOLATED_CHECKOUT_ALLOWED_REF, "nxntngkhkoynljcagmkq");
  assert.equal(INITIAL_CHECKOUT_ISOLATED_TEST_CONFIRM_VALUE, "isolated-test-only");
});
