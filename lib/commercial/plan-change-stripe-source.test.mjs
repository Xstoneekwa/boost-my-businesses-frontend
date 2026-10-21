import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveAccountCommercialSessionMode } from "./plan-change-source.ts";

const binding = {
  client_id: "client-1",
  account_id: "account-1",
  client_account_entitlement_id: "entitlement-1",
  commercial_checkout_session_id: "session-1",
  stripe_subscription_id: "sub_test_1",
  status: "active",
  livemode: false,
};

test("canonical Stripe Test subscription makes checkout_paid a plan-change source", () => {
  assert.equal(resolveAccountCommercialSessionMode({
    session: { id: "session-1", status: "checkout_paid" },
    subscriptions: [binding],
    clientId: "client-1",
    accountId: "account-1",
    entitlementId: "entitlement-1",
  }), "stripe_test");
});

test("Stripe source remains fail-closed for cross-account, live, inactive, or ambiguous bindings", () => {
  const input = {
    session: { id: "session-1", status: "checkout_paid" },
    clientId: "client-1",
    accountId: "account-1",
    entitlementId: "entitlement-1",
  };
  assert.equal(resolveAccountCommercialSessionMode({ ...input, subscriptions: [{ ...binding, account_id: "account-2" }] }), null);
  assert.equal(resolveAccountCommercialSessionMode({ ...input, subscriptions: [{ ...binding, livemode: true }] }), null);
  assert.equal(resolveAccountCommercialSessionMode({ ...input, subscriptions: [{ ...binding, status: "canceled" }] }), null);
  assert.equal(resolveAccountCommercialSessionMode({ ...input, subscriptions: [binding, { ...binding, stripe_subscription_id: "sub_test_2" }] }), null);
});

test("legacy simulated plan-change source remains supported", () => {
  assert.equal(resolveAccountCommercialSessionMode({
    session: { id: "session-1", status: "checkout_activated_test" },
    subscriptions: [],
    clientId: "client-1",
    accountId: "account-1",
    entitlementId: "entitlement-1",
  }), "simulated_test");
});

test("client routes Stripe-backed confirmation through the canonical Stripe endpoint", () => {
  const form = readFileSync(new URL("../../app/instagram-client/change-plan/PlanChangeCheckoutForm.tsx", import.meta.url), "utf8");
  assert.match(form, /quote\.activationMode === "stripe_test"/);
  assert.match(form, /\/api\/commercial\/checkout\/stripe\/plan-change\/create-session/);
  assert.match(form, /window\.location\.assign\(parsed\.data\.checkout_url\)/);
});
