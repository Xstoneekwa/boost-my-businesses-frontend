import assert from "node:assert/strict";
import test from "node:test";
import {
  canPersistNeedsMoreTargetsEmailAutomation,
  evaluateNeedsMoreDispatchAutomationGate,
  evaluateNeedsMoreMaterializePersistGate,
  evaluateNeedsMoreTargetsEmailAutomationGate,
  readClientEmailNeedsMoreTargetsAutomationEnabled,
} from "./client-email-needs-more-targets-automation-config.ts";

const watermarkEnv = {
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED: "true",
  CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT: "2026-06-29T13:00:00Z",
};

test("needs more targets automation gate is false by default", () => {
  assert.equal(readClientEmailNeedsMoreTargetsAutomationEnabled({}), false);
  const gate = evaluateNeedsMoreTargetsEmailAutomationGate({});
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "automation_disabled");
});

test("materialize persist gate does not require client sending", () => {
  const gate = evaluateNeedsMoreMaterializePersistGate({
    ...watermarkEnv,
    CLIENT_EMAIL_SENDING_ENABLED: "false",
  });
  assert.equal(gate.allowed, true);
  assert.equal(canPersistNeedsMoreTargetsEmailAutomation({
    ...watermarkEnv,
    CLIENT_EMAIL_SENDING_ENABLED: "false",
  }), true);
});

test("dispatch gate requires client sending and postmark", () => {
  const withoutSending = evaluateNeedsMoreDispatchAutomationGate({
    ...watermarkEnv,
    CLIENT_EMAIL_SENDING_ENABLED: "false",
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "token",
  });
  assert.equal(withoutSending.allowed, false);
  if (withoutSending.allowed) return;
  assert.equal(withoutSending.reason, "client_sending_disabled");

  const withSending = evaluateNeedsMoreDispatchAutomationGate({
    ...watermarkEnv,
    CLIENT_EMAIL_SENDING_ENABLED: "true",
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "token",
  });
  assert.equal(withSending.allowed, true);
});
