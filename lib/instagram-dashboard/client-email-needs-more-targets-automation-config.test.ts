import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateNeedsMoreTargetsEmailAutomationGate,
  readClientEmailNeedsMoreTargetsAutomationEnabled,
} from "./client-email-needs-more-targets-automation-config.ts";

test("needs more targets automation gate is false by default", () => {
  assert.equal(readClientEmailNeedsMoreTargetsAutomationEnabled({}), false);
  const gate = evaluateNeedsMoreTargetsEmailAutomationGate({});
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "automation_disabled");
});

test("both automation and client sending gates must be true to allow lifecycle persistence", () => {
  const gate = evaluateNeedsMoreTargetsEmailAutomationGate({
    CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
    CLIENT_EMAIL_SENDING_ENABLED: "true",
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "token",
  });
  assert.equal(gate.allowed, true);
});
