import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const activationSource = readFileSync(
  new URL("./activate-client-account-entitlement-from-checkout.ts", import.meta.url),
  "utf8",
);

test("real Stripe fulfillment and simulated checkout keep distinct audit provenance", () => {
  assert.match(
    activationSource,
    /input\.mode === "stripe" \? "stripe_checkout_activated" : "simulated_checkout_activated"/,
  );
});

test("Stripe activation remains webhook-gated", () => {
  assert.match(activationSource, /if \(!input\.stripeWebhookConfirmed\)/);
  assert.match(activationSource, /stripe_webhook_required/);
});
