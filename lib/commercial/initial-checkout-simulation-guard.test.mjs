import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseInitialCheckoutSimulation,
  projectInitialCheckoutSimulationAvailability,
} from "./initial-checkout-simulation-guard.ts";
import { withInitialCheckoutAllowlist } from "./initial-checkout-test-env.ts";

const ALLOWED_EMAIL = "initial_checkout_test@example.invalid";
const BASE_ENV = withInitialCheckoutAllowlist([ALLOWED_EMAIL]);

test("initial checkout simulation requires every guard condition", () => {
  assert.equal(canUseInitialCheckoutSimulation(ALLOWED_EMAIL, BASE_ENV).ok, true);

  assert.equal(
    canUseInitialCheckoutSimulation(ALLOWED_EMAIL, { ...BASE_ENV, SUPABASE_URL: "" }).reason,
    "isolated_ref_required",
  );
  assert.equal(
    canUseInitialCheckoutSimulation(ALLOWED_EMAIL, { ...BASE_ENV, SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM: "" }).reason,
    "isolated_test_confirm_required",
  );
  assert.equal(
    canUseInitialCheckoutSimulation(ALLOWED_EMAIL, { ...BASE_ENV, SIMULATED_CHECKOUT_ENABLED: "false" }).reason,
    "simulated_checkout_disabled",
  );
  assert.equal(
    canUseInitialCheckoutSimulation("real@company.com", BASE_ENV).reason,
    "fictional_email_required",
  );
  assert.equal(
    canUseInitialCheckoutSimulation("probe@example.invalid", BASE_ENV).reason,
    "simulated_checkout_email_not_allowlisted",
  );
});

test("initial checkout availability projection waits for email before granting permission", () => {
  const missingEmail = projectInitialCheckoutSimulationAvailability("", BASE_ENV);
  assert.equal(missingEmail.simulationAvailable, false);
  assert.equal(missingEmail.simulationUnavailableReason, null);

  const allowed = projectInitialCheckoutSimulationAvailability(ALLOWED_EMAIL, BASE_ENV);
  assert.equal(allowed.simulationAvailable, true);
  assert.equal(allowed.simulationUnavailableReason, null);

  const blocked = projectInitialCheckoutSimulationAvailability("probe@example.invalid", BASE_ENV);
  assert.equal(blocked.simulationAvailable, false);
  assert.equal(blocked.simulationUnavailableReason, "simulated_checkout_email_not_allowlisted");
});

test("initial checkout availability hides simulation when server ref is wrong", () => {
  const blocked = projectInitialCheckoutSimulationAvailability(ALLOWED_EMAIL, {
    ...BASE_ENV,
    SUPABASE_URL: "https://wrongref.supabase.co",
  });
  assert.equal(blocked.simulationAvailable, false);
  assert.equal(blocked.simulationUnavailableReason, "isolated_ref_required");
});
