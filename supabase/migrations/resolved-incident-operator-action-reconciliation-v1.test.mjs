import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("./20260801183242_resolved_incident_operator_action_reconciliation_v1.sql", import.meta.url),
  "utf8",
);

test("incident resolution closes only linked active operator-review blockers", () => {
  assert.match(sql, /after update of status on public\.account_incidents/);
  assert.match(sql, /new\.status = 'resolved' and old\.status is distinct from new\.status/);
  assert.match(sql, /a\.incident_id = new\.id/);
  assert.match(sql, /a\.action_type in \('operator_review_required', 'review_auto_restart_hard_stop'\)/);
  assert.match(sql, /a\.status in \('pending', 'acknowledged', 'pending_verification', 'code_submitted'\)/);
});

test("reconciliation removes the blocker without claiming human review", () => {
  assert.match(sql, /status = 'resolved'/);
  assert.match(sql, /blocking_campaign = false/);
  assert.match(sql, /requires_client_action = false/);
  assert.match(sql, /'operator_review_performed', false/);
  assert.match(sql, /'contract', 'resolved_incident_operator_action_v1'/);
});

test("historical backfill is generic and restricted to already resolved incidents", () => {
  const backfill = sql.slice(sql.indexOf("-- Reconcile every legacy orphan"));
  assert.match(backfill, /from public\.account_incidents i/);
  assert.match(backfill, /a\.incident_id = i\.id/);
  assert.match(backfill, /i\.status = 'resolved'/);
  assert.match(backfill, /'source', 'legacy_orphan_backfill'/);
  assert.doesNotMatch(backfill, /account_run_requests|ig_runs|schedule_assignments/);
});

test("trigger function is service-role only and uses an empty search path", () => {
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /revoke all on function public\.reconcile_operator_actions_from_resolved_incident_v1\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.reconcile_operator_actions_from_resolved_incident_v1\(\)[\s\S]*to service_role/);
});
