import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateClientEmailTestSendingGate,
  maskEmailForDisplay,
  projectClientEmailTestDeliveryStatus,
  rejectForbiddenTestDeliveryRecipientFields,
} from "./client-email-test-config.ts";

const openTestEnv = {
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_TEST_SENDING_ENABLED: "true",
  CLIENT_EMAIL_TEST_RECIPIENT: "liam@example.com",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "server-token",
};

test("test gates closed by default", () => {
  const gate = evaluateClientEmailTestSendingGate({});
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "test_sending_disabled");
});

test("client sending enabled blocks test delivery", () => {
  const gate = evaluateClientEmailTestSendingGate({
    ...openTestEnv,
    CLIENT_EMAIL_SENDING_ENABLED: "true",
  });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "client_sending_must_stay_disabled");
});

test("missing test recipient blocks delivery", () => {
  const gate = evaluateClientEmailTestSendingGate({
    ...openTestEnv,
    CLIENT_EMAIL_TEST_RECIPIENT: "",
  });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "test_recipient_missing");
});

test("maskEmailForDisplay hides local part", () => {
  assert.equal(maskEmailForDisplay("liam@example.com"), "l***@example.com");
  assert.equal(maskEmailForDisplay("bad"), null);
});

test("rejectForbiddenTestDeliveryRecipientFields rejects arbitrary recipient", () => {
  const message = rejectForbiddenTestDeliveryRecipientFields({ recipient_email: "other@example.com" });
  assert.ok(message);
  assert.match(message!, /recipient_email/);
});

test("projectClientEmailTestDeliveryStatus disables send when schema not ready", () => {
  const status = projectClientEmailTestDeliveryStatus({
    env: openTestEnv,
    testSchemaReady: false,
  });
  assert.equal(status.canSendTest, false);
  assert.equal(status.testRecipientMasked, "l***@example.com");
  assert.match(status.disabledReason ?? "", /schema migration/i);
});
