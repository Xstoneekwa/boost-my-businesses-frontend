import assert from "node:assert/strict";
import test from "node:test";
import { notificationCategories, notificationChannels, notificationEnvironments } from "./contracts.ts";
import { providerPayload, renderBusinessMessage, syntheticTestEvent } from "./templates.ts";

test("all categories share one semantic template path across test/live and Slack/Discord", () => {
  assert.deepEqual(notificationCategories, ["incident", "new_client", "plan_change", "auto_login", "ct_lifecycle"]);
  assert.deepEqual(notificationChannels, ["slack", "discord"]);
  assert.deepEqual(notificationEnvironments, ["test", "live"]);
  for (const category of notificationCategories) {
    const testEvent = syntheticTestEvent(category, "test");
    const liveEvent = syntheticTestEvent(category, "live");
    const testMessage = renderBusinessMessage(testEvent);
    const liveMessage = renderBusinessMessage(liveEvent);
    assert.match(testMessage, /^\[Stripe Test\]/);
    assert.equal(testMessage.replace(/^\[Stripe Test\] /, ""), liveMessage);
    assert.deepEqual(providerPayload("slack", liveMessage), { text: liveMessage });
    assert.deepEqual(providerPayload("discord", liveMessage), { content: liveMessage });
  }
});

test("business templates contain no developer-facing vocabulary", () => {
  const forbidden = /rpc|table|entitlement_consumed|identity_proof|webhook[_ ]id|stack trace|service_role/i;
  const events = [
    { category: "new_client" as const, environment: "live" as const, eventType: "new_client.activated", businessPayload: { username: "@exemple", plan: "Pro", duration: "3 mois", amount: "531,90 €" } },
    { category: "plan_change" as const, environment: "live" as const, eventType: "plan_change.completed", businessPayload: { username: "@exemple", previousPlan: "Growth", newPlan: "Pro", expiry: "30 novembre 2026", remainingCredit: "135,85 €" } },
    { category: "auto_login" as const, environment: "live" as const, eventType: "auto_login.wrong_password", businessPayload: { username: "@exemple" } },
    { category: "auto_login" as const, environment: "live" as const, eventType: "auto_login.challenge", businessPayload: { username: "@exemple" } },
  ];
  for (const event of events) assert.doesNotMatch(renderBusinessMessage(event), forbidden);
});

test("success is emitted only by explicit terminal event types", () => {
  assert.match(renderBusinessMessage({ category: "new_client", environment: "live", eventType: "new_client.activated", businessPayload: { username: "@x", plan: "Pro", duration: "3 mois" } }), /Compte activé et prêt/);
  assert.match(renderBusinessMessage({ category: "auto_login", environment: "live", eventType: "auto_login.connected", businessPayload: { username: "@x", plan: "Pro" } }), /Connecté et prêt/);
});
