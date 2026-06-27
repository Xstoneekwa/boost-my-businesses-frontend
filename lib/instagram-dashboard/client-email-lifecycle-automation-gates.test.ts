import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateClientEmailLifecycleAutomationGate,
  evaluateMaterializeLifecycleAutomationGate,
  isNeedsMoreSignalEligibleAfterWatermark,
  readClientEmailLifecycleAutomationEnabled,
  readClientEmailNeedsMoreTargetsAutomationEnabledAt,
} from "./client-email-lifecycle-automation-gates.ts";

const closedEnv = {
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "false",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "false",
};

test("lifecycle automation gate defaults closed", () => {
  assert.equal(readClientEmailLifecycleAutomationEnabled({}), false);
  const gate = evaluateClientEmailLifecycleAutomationGate(closedEnv);
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "automation_disabled");
});

test("needs-more watermark reader does not invent a default", () => {
  assert.equal(readClientEmailNeedsMoreTargetsAutomationEnabledAt({}), null);
  assert.equal(readClientEmailNeedsMoreTargetsAutomationEnabledAt({
    CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "not-a-date",
  }), null);
});

test("needs-more signal eligibility requires watermark and post-watermark action", () => {
  const watermark = new Date("2026-07-01T00:00:00.000Z");
  assert.equal(isNeedsMoreSignalEligibleAfterWatermark({
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    watermark,
  }), false);
  assert.equal(isNeedsMoreSignalEligibleAfterWatermark({
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    watermark,
  }), true);
  assert.equal(isNeedsMoreSignalEligibleAfterWatermark({
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    watermark,
  }), true);
  assert.equal(isNeedsMoreSignalEligibleAfterWatermark({
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    watermark: null,
  }), false);
});

test("lifecycle materialize gate requires watermark when automation enabled", () => {
  const gate = evaluateMaterializeLifecycleAutomationGate({
    CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
  });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "watermark_not_configured");
});

test("lifecycle gate requires watermark when automation enabled", () => {
  const gate = evaluateClientEmailLifecycleAutomationGate({
    CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED: "true",
    CLIENT_EMAIL_SENDING_ENABLED: "true",
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "token",
  });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "watermark_not_configured");
});
