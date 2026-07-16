import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildCanonicalIncidentNotification } from "./canonical-incident-notification.ts";

const consultableCases = [
  "welcome_surface_unstable",
  "followers_suggestions_boundary_recovery_failed",
  "structured worker failure",
  "operator review required",
  "operator review resolved",
  "consultable incident without action",
];

test("all consultable incidents use one canonical English CTA for Slack and Discord", () => {
  for (const reason of consultableCases) {
    const notification = buildCanonicalIncidentNotification({
      title: "Runtime incident",
      incidentId: "incident-1",
      actionId: reason.includes("operator") ? "action-1" : null,
      accountId: "account-1",
      accountUsername: "tracker",
      reason,
      state: reason.endsWith("resolved") ? "resolved" : "open",
      severity: "critical",
      runId: "run-1",
      requestId: "request-1",
      operatorId: reason.includes("operator") ? "operator-1" : null,
    });

    assert.match(notification.slackBody.text, /\|Open Incidents\/Actions>/);
    assert.match(notification.discordBody.content, /\[Open Incidents\/Actions\]\(/);
    assert.doesNotMatch(notification.slackBody.text, /\nhttps?:\/\//);
    assert.doesNotMatch(notification.discordBody.content, /\nhttps?:\/\//);
    assert.match(notification.text, /Reason:/);
    assert.match(notification.text, /State:/);
  }
});

test("runtime, scheduled failure, and operator review paths import the canonical builder", () => {
  const scheduled = readFileSync(new URL("./scheduled-early-failure-retry.ts", import.meta.url), "utf8");
  const operatorReview = readFileSync(new URL("./operator-review-notifications.ts", import.meta.url), "utf8");
  assert.match(scheduled, /buildCanonicalIncidentNotification/);
  assert.match(operatorReview, /buildCanonicalIncidentNotification/);
  assert.doesNotMatch(scheduled, /dashboardBaseUrl/);
  assert.doesNotMatch(scheduled, /channel === "discord" \? \{ content: text \}/);
});
