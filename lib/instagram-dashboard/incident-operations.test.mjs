import assert from "node:assert/strict";
import test from "node:test";

import { buildIncidentList, redactIncidentMetadata } from "./incident-operations.ts";

const incident = {
  id: "inc-1",
  status: "open",
  severity: "critical",
  incident_type: "run_identity_verification_failed",
  reason: "identity_mismatch",
  account_id: "account-1",
  account_username: "safe_username",
  last_seen_at: "2026-07-24T12:00:00Z",
  metadata: { run_request_id: "request-1", password: "never", package_name: "never" },
};

test("incident read model keeps stable reasons and redacts sensitive metadata", () => {
  const [row] = buildIncidentList([incident], [], []);
  assert.equal(row.reasonCode, "identity_mismatch");
  assert.equal(row.runRequestId, "request-1");
  assert.deepEqual(row.metadataSafe, { run_request_id: "request-1" });
});

test("resolved incidents always remain resolved even with an active historical action", () => {
  const [row] = buildIncidentList([{ ...incident, status: "resolved" }], [], [{ incident_id: "inc-1", status: "pending_verification" }]);
  assert.equal(row.displayState, "resolved");
});

test("pending verification is action required only for an active incident", () => {
  const [row] = buildIncidentList([incident], [], [{ incident_id: "inc-1", status: "pending_verification" }]);
  assert.equal(row.displayState, "action_required");
});

test("empty incident list is a normal empty result", () => {
  assert.deepEqual(buildIncidentList([], [], []), []);
});

test("redaction drops nested and credential-like values", () => {
  assert.deepEqual(redactIncidentMetadata({ note: "safe", nested: { value: 1 }, token: "never" }), { note: "safe" });
});

test("notification provider errors are never relayed to BotApp", () => {
  const [row] = buildIncidentList([incident], [{
    incident_id: "inc-1",
    channel: "slack",
    status: "failed",
    last_error: "provider-secret-value",
  }], []);
  assert.equal(row.deliveries[0].lastError, "Delivery failed; review server logs.");
  assert.doesNotMatch(JSON.stringify(row), /provider-secret-value/);
});
