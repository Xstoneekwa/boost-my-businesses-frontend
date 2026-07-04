import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveCanonicalSubscriptionStatus,
  shouldApplySubscriptionStatus,
} from "./stripe-subscription-projection-state.ts";

describe("stripe subscription projection state", () => {
  it("never downgrades active to incomplete", () => {
    assert.equal(shouldApplySubscriptionStatus("active", "incomplete"), false);
    assert.equal(shouldApplySubscriptionStatus("trialing", "incomplete"), false);
  });

  it("allows lifecycle progression incomplete -> active", () => {
    assert.equal(shouldApplySubscriptionStatus("incomplete", "active"), true);
  });

  it("converges stale incomplete after fulfilled checkout and invoice.paid", () => {
    const status = resolveCanonicalSubscriptionStatus([
      { status: "incomplete", receivedAtMs: 100, source: "customer.subscription.created" },
      { status: "incomplete", receivedAtMs: 200, source: "customer.subscription.updated" },
    ], { checkoutFulfilled: true, invoicePaid: true });
    assert.equal(status, "active");
  });

  it("keeps terminal cancellation priority", () => {
    const status = resolveCanonicalSubscriptionStatus([
      { status: "active", receivedAtMs: 100, source: "customer.subscription.updated" },
      { status: "canceled", receivedAtMs: 200, source: "customer.subscription.deleted", isTerminalEvent: true },
    ], { checkoutFulfilled: true, invoicePaid: true });
    assert.equal(status, "canceled");
  });

  it("does not apply late active update over an existing canceled projection", () => {
    assert.equal(shouldApplySubscriptionStatus("canceled", "active"), false);
    assert.equal(shouldApplySubscriptionStatus("canceled", "past_due"), false);
  });

  it("applies newer active over older incomplete chronologically", () => {
    const status = resolveCanonicalSubscriptionStatus([
      { status: "incomplete", receivedAtMs: 100, source: "customer.subscription.created" },
      { status: "active", receivedAtMs: 300, source: "customer.subscription.updated" },
    ]);
    assert.equal(status, "active");
  });

  it("does not force active without checkout and invoice signals", () => {
    const status = resolveCanonicalSubscriptionStatus([
      { status: "incomplete", receivedAtMs: 100, source: "customer.subscription.created" },
    ]);
    assert.equal(status, "incomplete");
  });

  it("uses checkout fulfilled and invoice paid when no subscription snapshots exist", () => {
    const status = resolveCanonicalSubscriptionStatus([], {
      checkoutFulfilled: true,
      invoicePaid: true,
    });
    assert.equal(status, "active");
  });
});
