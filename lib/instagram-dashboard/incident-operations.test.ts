import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIncidentCounters,
  buildIncidentList,
  incidentDeliveryState,
  incidentDisplayState,
  isTestIncident,
  mapIncidentRow,
  redactIncidentMetadata,
} from "./incident-operations.ts";

const ACCOUNT_ID = "e9c7462b-fc0e-46c9-8d40-1e07e0f6a41b";
const RUN_ID = "9e46c4a5-72c5-4b16-9f0f-96f6f2ff11aa";

function identityIncidentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inc-1",
    status: "open",
    severity: "critical",
    incident_type: "run_identity_verification_failed",
    reason: "actual_logged_in_username_not_detected",
    failure_reason: "actual_logged_in_username_not_detected",
    action_required:
      "Impossible de confirmer le compte Instagram actif. Intervention humaine requise avant reprise.",
    admin_message: "Identity preflight could not prove the active username.",
    account_id: ACCOUNT_ID,
    account_username: "mythyl_fitness",
    run_id: RUN_ID,
    occurrence_count: 2,
    first_seen_at: "2026-07-06T22:00:00Z",
    last_seen_at: "2026-07-06T22:05:00Z",
    resolved_at: null,
    source: "run_dispatcher",
    metadata: {
      run_request_id: "req-1",
      run_type: "account_session",
      exit_code: 75,
    },
    ...overrides,
  };
}

test("mapIncidentRow keeps the true reason and stable display state", () => {
  const model = mapIncidentRow(identityIncidentRow());
  assert.equal(model.reasonCode, "actual_logged_in_username_not_detected");
  assert.equal(model.incidentType, "run_identity_verification_failed");
  assert.equal(model.displayState, "action_required");
  assert.equal(model.severity, "critical");
  assert.equal(model.accountUsername, "mythyl_fitness");
  assert.equal(model.runRequestId, "req-1");
  assert.equal(model.accountHref, `/instagram-dashboard/accounts/${ACCOUNT_ID}`);
  assert.match(model.actionRequired ?? "", /Intervention humaine requise/);
});

test("display state derives action_required only for active incidents", () => {
  assert.equal(incidentDisplayState(identityIncidentRow()), "action_required");
  assert.equal(
    incidentDisplayState(identityIncidentRow({ status: "resolved" })),
    "resolved",
  );
  assert.equal(
    incidentDisplayState(identityIncidentRow({ action_required: null })),
    "open",
  );
});

test("metadata is redacted: no secrets, serials, packages or raw xml", () => {
  const safe = redactIncidentMetadata({
    run_request_id: "req-1",
    exit_code: 75,
    password: "never",
    slack_webhook: "https://hooks.slack.com/services/X",
    adb_serial: "RFGL145LZHE",
    package_name: "com.instagram.androif",
    raw_xml: "<node />",
    note: "<?xml version='1.0'?>",
    nested: { deep: "dropped" },
  });
  assert.deepEqual(Object.keys(safe).sort(), ["exit_code", "run_request_id"]);
});

test("delivery state aggregates outbox rows per incident", () => {
  assert.equal(incidentDeliveryState([]), "none");
  assert.equal(
    incidentDeliveryState([
      { channel: "slack", status: "sent", attemptCount: 1, deliveredAt: "x", lastError: null },
      { channel: "discord", status: "sent", attemptCount: 1, deliveredAt: "x", lastError: null },
    ]),
    "delivered",
  );
  assert.equal(
    incidentDeliveryState([
      { channel: "slack", status: "sent", attemptCount: 1, deliveredAt: "x", lastError: null },
      { channel: "discord", status: "failed", attemptCount: 3, deliveredAt: null, lastError: "http_status_500" },
    ]),
    "delivery_degraded",
  );
  assert.equal(
    incidentDeliveryState([
      { channel: "slack", status: "pending", attemptCount: 1, deliveredAt: null, lastError: null },
    ]),
    "pending",
  );
});

test("test incidents are flagged and excluded by default", () => {
  const testRow = identityIncidentRow({
    id: "inc-test",
    incident_type: "system_test_incident",
    metadata: { test: true },
  });
  assert.equal(isTestIncident(testRow), true);
  assert.equal(isTestIncident(identityIncidentRow()), false);

  const hidden = buildIncidentList([identityIncidentRow(), testRow], []);
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].id, "inc-1");

  const visible = buildIncidentList([identityIncidentRow(), testRow], [], {
    includeTest: true,
  });
  assert.equal(visible.length, 2);
});

test("counters exclude test incidents and count delivery degradation", () => {
  const rows = [
    identityIncidentRow(),
    identityIncidentRow({ id: "inc-2", status: "resolved", resolved_at: "2026-07-06T23:00:00Z" }),
    identityIncidentRow({ id: "inc-3", action_required: null }),
    identityIncidentRow({ id: "inc-test", incident_type: "system_test_incident", metadata: { test: true } }),
  ];
  const notifications = [
    { incident_id: "inc-3", channel: "slack", status: "failed", attempt_count: 3, last_error: "http_status_500" },
  ];
  const models = buildIncidentList(rows, notifications, { includeTest: true });
  const counters = buildIncidentCounters(models);
  assert.equal(counters.total, 3);
  assert.equal(counters.actionRequired, 1);
  assert.equal(counters.resolved, 1);
  assert.equal(counters.open, 1);
  assert.equal(counters.deliveryDegraded, 1);
});

test("notifications are attached to their incident", () => {
  const models = buildIncidentList(
    [identityIncidentRow()],
    [
      { incident_id: "inc-1", channel: "slack", status: "sent", attempt_count: 1, delivered_at: "2026-07-06T22:06:00Z" },
      { incident_id: "inc-1", channel: "discord", status: "sent", attempt_count: 1, delivered_at: "2026-07-06T22:06:01Z" },
      { incident_id: "other", channel: "slack", status: "failed", attempt_count: 1 },
    ],
  );
  assert.equal(models[0].deliveries.length, 2);
  assert.equal(models[0].deliveryState, "delivered");
});
