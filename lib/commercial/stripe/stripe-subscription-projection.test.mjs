import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeStripeSubscriptionProjectionInput } from "./stripe-subscription-projection.ts";

describe("stripe subscription projection merge", () => {
  it("claims a normal Stripe Test projection that arrived unbound before checkout completion", () => {
    const merged = mergeStripeSubscriptionProjectionInput({
      client_id: "client-1",
      account_id: null,
      status: "active",
    }, {
      clientId: "client-1",
      stripeSubscriptionId: "sub_normal_ordering",
      stripeCustomerId: "cus_1",
      stripePriceId: "price_1",
      accountId: "account-1",
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });

    assert.equal(merged.account_id, "account-1");
  });

  it("fails closed when a normal Stripe Test projection is already bound to another account", () => {
    assert.throws(() => mergeStripeSubscriptionProjectionInput({
      client_id: "client-1",
      account_id: "account-foreign",
      status: "active",
    }, {
      clientId: "client-1",
      stripeSubscriptionId: "sub_normal_ordering",
      stripeCustomerId: "cus_1",
      stripePriceId: "price_1",
      accountId: "account-target",
      status: "active",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }), /stripe_subscription_cross_account_conflict/);
  });

  it("preserves checkout and entitlement foreign keys when incoming omits them", () => {
    const merged = mergeStripeSubscriptionProjectionInput({
      status: "active",
      commercial_checkout_session_id: "checkout-1",
      client_account_entitlement_id: "entitlement-1",
      stripe_price_id: "price_existing",
    }, {
      clientId: "client-1",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      stripePriceId: null,
      status: "incomplete",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });

    assert.equal(merged.status, "active");
    assert.equal(merged.commercial_checkout_session_id, "checkout-1");
    assert.equal(merged.client_account_entitlement_id, "entitlement-1");
  });

  it("allows incoming lifecycle progression incomplete to active", () => {
    const merged = mergeStripeSubscriptionProjectionInput({
      status: "incomplete",
    }, {
      clientId: "client-1",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      stripePriceId: "price_1",
      status: "active",
      currentPeriodStart: "2026-07-04T00:00:00.000Z",
      currentPeriodEnd: "2026-08-04T00:00:00.000Z",
      cancelAtPeriodEnd: false,
    });

    assert.equal(merged.status, "active");
  });

  it("persists billing_paused and pause_collection_behavior from incoming webhook merge", () => {
    const merged = mergeStripeSubscriptionProjectionInput({
      status: "active",
      billing_paused: true,
      pause_collection_behavior: "void",
    }, {
      clientId: "client-1",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
      stripePriceId: "price_1",
      status: "active",
      currentPeriodStart: "2026-07-04T00:00:00.000Z",
      currentPeriodEnd: "2026-08-04T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      billingPaused: true,
      pauseCollectionBehavior: "void",
    });

    assert.equal(merged.billing_paused, true);
    assert.equal(merged.pause_collection_behavior, "void");
    assert.equal(merged.status, "active");
  });
});
