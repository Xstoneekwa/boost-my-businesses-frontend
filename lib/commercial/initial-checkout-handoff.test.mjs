import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveCheckoutHandoff } from "./checkout-context.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("initial checkout success handoff stays on login then client dashboard", () => {
  const handoff = resolveCheckoutHandoff("public_new_workspace");
  assert.equal(handoff.type, "email_login");
  assert.equal(handoff.loginPath, "/instagram-login");

  const loginSource = source("../../app/instagram-login/InstagramLoginClient.tsx");
  const formSource = source("../../app/instagram-growth/checkout/CommercialCheckoutForm.tsx");
  const activateSource = source("./activate-client-account-entitlement-from-checkout.ts");

  assert.match(loginSource, /instagramPostLoginPath\(payload\.user\?\.role\)/);
  assert.doesNotMatch(formSource, /router\.push\("\/instagram-growth"\)/);
  assert.doesNotMatch(formSource, /instagram-growth\/index\.html/);
  assert.match(activateSource, /payment_status: "simulated_confirmed"/);
  assert.match(activateSource, /confirmCommercialPayment/);
});

test("initial checkout activate route documents forbidden simulation codes", () => {
  const routeSource = source("../../app/api/commercial/checkout/simulated/activate/route.ts");
  const quoteSource = source("../../app/api/commercial/checkout/quote/route.ts");

  assert.match(quoteSource, /projectInitialCheckoutSimulationAvailability/);
  assert.match(quoteSource, /simulationAvailable/);
  assert.doesNotMatch(quoteSource, /payment_required/);
});
