import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  firstAutomationBlockingIncident,
  incidentAutomationBlockReason,
  incidentRequiresOperatorAction,
} from "../lib/instagram-dashboard/incident-automation-blocking.ts";
import { buildIncidentList } from "../lib/instagram-dashboard/incident-operations.ts";

const ACCOUNT_ID = "ba73eda4-d22a-4b93-9683-2af7b8aab764";

function incident(overrides = {}) {
  return {
    id: "incident-1",
    account_id: ACCOUNT_ID,
    account_username: "fixture_account",
    status: "open",
    incident_type: "run_worker_failure",
    reason: "worker_exit_nonzero",
    metadata: {},
    created_at: "2026-07-22T09:00:00Z",
    last_seen_at: "2026-07-22T09:00:00Z",
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    id: "action-1",
    incident_id: "incident-1",
    account_id: ACCOUNT_ID,
    action_type: "operator_review_required",
    status: "pending",
    blocking_campaign: false,
    requires_client_action: false,
    created_at: "2026-07-22T09:01:00Z",
    updated_at: "2026-07-22T09:01:00Z",
    ...overrides,
  };
}

test("open incident with blocking_campaign=true blocks", () => {
  assert.equal(incidentAutomationBlockReason(incident({ blocking_campaign: true }), []), "blocking_incident_active");
});

test("open incident with operator_review_required=true blocks", () => {
  assert.equal(incidentAutomationBlockReason(incident({ operator_review_required: true }), []), "operator_review_required");
});

test("open incident with an active linked operator review blocks", () => {
  assert.equal(incidentAutomationBlockReason(incident(), [action()]), "operator_review_required");
});

test("pending_verification action has a precise blocker", () => {
  assert.equal(incidentAutomationBlockReason(incident(), [action({ status: "pending_verification" })]), "pending_verification_action");
});

test("open non-blocking incident does not block", () => {
  assert.equal(incidentAutomationBlockReason(incident(), []), null);
});

test("acknowledged incident without campaign or operator action does not block", () => {
  assert.equal(incidentAutomationBlockReason(incident({ status: "acknowledged" }), []), null);
});

test("stale open incident without an active action does not block", () => {
  assert.equal(incidentAutomationBlockReason(incident({ last_seen_at: "2026-06-01T00:00:00Z" }), []), null);
});

test("latest resolved action makes a retained open incident non-blocking", () => {
  const oldPending = action();
  const resolved = action({ id: "action-2", status: "resolved", resolved_at: "2026-07-22T10:00:00Z", created_at: "2026-07-22T10:00:00Z", updated_at: "2026-07-22T10:00:00Z" });
  assert.equal(incidentAutomationBlockReason(incident(), [oldPending, resolved]), null);
});

test("resolved incident never blocks", () => {
  assert.equal(incidentAutomationBlockReason(incident({ status: "resolved", resolved_at: "2026-07-22T10:00:00Z" }), [action()]), null);
});

test("explicit active login block blocks without relying on open alone", () => {
  assert.equal(incidentAutomationBlockReason(incident({ incident_type: "account_login_required", metadata: { login_block_active: true } }), []), "login_block_active");
});

test("explicit active social block blocks without relying on open alone", () => {
  assert.equal(incidentAutomationBlockReason(incident({ incident_type: "instagram_restriction", metadata: { social_block_active: true } }), []), "social_block_active");
});

test("one blocking incident among several returns its precise reason", () => {
  const informational = incident({ id: "incident-info" });
  const blocking = incident({ id: "incident-block" });
  const blockingAction = action({ incident_id: "incident-block", blocking_campaign: true });
  assert.deepEqual(firstAutomationBlockingIncident([informational, blocking], [blockingAction]), {
    incident: blocking,
    reason: "blocking_incident_active",
  });
});

test("multiple non-blocking incidents pass", () => {
  assert.equal(firstAutomationBlockingIncident([
    incident({ id: "incident-1" }),
    incident({ id: "incident-2", status: "acknowledged" }),
  ], []), null);
});

test("BotApp Action required and planner share active operator semantics", () => {
  const row = incident();
  const operatorAction = action();
  const [botapp] = buildIncidentList([row], [], [operatorAction]);
  assert.equal(incidentRequiresOperatorAction(row, [operatorAction]), true);
  assert.equal(incidentAutomationBlockReason(row, [operatorAction]), "operator_review_required");
  assert.equal(botapp.displayState, "action_required");

  const resolvedAction = action({ status: "resolved", resolved_at: "2026-07-22T10:00:00Z" });
  const [resolvedBotapp] = buildIncidentList([row], [], [resolvedAction]);
  assert.equal(incidentRequiresOperatorAction(row, [resolvedAction]), false);
  assert.equal(incidentAutomationBlockReason(row, [resolvedAction]), null);
  assert.equal(resolvedBotapp.displayState, "reviewed");
});

test("Slack and Discord delivery state never affects automation eligibility", () => {
  const row = incident({ notification_status: "failed", slack_delivery: "pending", discord_delivery: "sent" });
  assert.equal(incidentAutomationBlockReason(row, []), null);
});

test("j_automatise retained incidents are classified from fields, not ids", () => {
  const retained = [
    incident({
      id: "4bad158b-9169-4542-9570-e4ff43ed5435",
      incident_type: "run_worker_failure",
      action_required: "Review internal run logs.",
      metadata: { exit_code: 75, run_type: "scheduled_session_preflight" },
    }),
    incident({
      id: "131dac92-7613-4136-8ecf-15ac0be334af",
      incident_type: "run_worker_failure",
      action_required: "Review internal run logs.",
      metadata: { exit_code: 1, run_type: "login_provisioning" },
    }),
  ];
  const resolvedActions = retained.map((row, index) => action({
    id: `resolved-${index}`,
    incident_id: row.id,
    status: "resolved",
    blocking_campaign: false,
    resolved_at: "2026-07-22T19:39:30Z",
    created_at: "2026-07-22T19:39:30Z",
    updated_at: "2026-07-22T19:39:30Z",
  }));
  assert.equal(firstAutomationBlockingIncident(retained, resolvedActions), null);
});

test("Auto Restart data uses the canonical blocker instead of open status existence", () => {
  const source = readFileSync(new URL("../app/instagram-dashboard/auto-restart-data.ts", import.meta.url), "utf8");
  assert.match(source, /firstAutomationBlockingIncident/);
  assert.match(source, /incidentBlockReason:/);
  assert.doesNotMatch(source, /hasOpenIncident/);
  assert.doesNotMatch(source, /open_incident_blocked/);
});
