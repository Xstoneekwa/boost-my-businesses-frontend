import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCheckoutSubscriptionPayload,
  buildSimulatedCheckoutSubscriptionPayload,
} from "./checkout-workspace-payloads.ts";
import { resolveCommercialCheckoutProvenance } from "./commercial-provenance.ts";

describe("commercial checkout provenance", () => {
  it("maps simulation and stripe test modes", () => {
    assert.equal(resolveCommercialCheckoutProvenance({ mode: "simulated" }), "simulated_checkout");
    assert.equal(resolveCommercialCheckoutProvenance({ mode: "stripe" }), "stripe_test");
    assert.equal(resolveCommercialCheckoutProvenance({ mode: "stripe", stripeLivemode: true }), "stripe_live");
  });

  it("keeps simulated checkout subscription source unchanged", () => {
    const payload = buildSimulatedCheckoutSubscriptionPayload("client-1");
    assert.equal(payload.metadata.source, "simulated_checkout");
  });

  it("writes stripe_test subscription source for stripe activations", () => {
    const payload = buildCheckoutSubscriptionPayload("client-1", { provenance: "stripe_test" });
    assert.equal(payload.metadata.source, "stripe_test");
  });
});
