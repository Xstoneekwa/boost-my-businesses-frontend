import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("./20260813213000_post_connection_growth_readiness_reconciliation_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../rollback/20260813213000_post_connection_growth_readiness_reconciliation_v1.down.sql", import.meta.url),
  "utf8",
);

test("operator confirmation uses the canonical 15 eligible-target threshold", () => {
  assert.match(migration, /v_eligible_targets\s*<\s*15/);
  assert.match(migration, /'required_eligible_targets',\s*15/);
  assert.match(migration, /'insufficient_eligible_targets'/);
  assert.doesNotMatch(migration, /v_eligible_targets\s*=\s*0/);
});

test("eligible targets are counted by canonical status, quality, verification and archive fields", () => {
  assert.match(migration, /status[\s\S]*\('valid', 'active'\)/);
  assert.match(migration, /quality_status[\s\S]*'eligible'/);
  assert.match(migration, /verification_status[\s\S]*'found'/);
  assert.match(migration, /archived_at is null/);
  assert.match(migration, /deleted_at is null/);
});

test("all exact login paths converge through identity success and terminal request hooks", () => {
  assert.match(migration, /client_instagram_account_growth_readiness_v1/);
  assert.match(migration, /login_request_terminal_growth_readiness_v1/);
  assert.match(migration, /login_blocker_terminal_growth_readiness_v1/);
  assert.match(migration, /reconcile_connected_instagram_growth_readiness_v1/);
});

test("reconciliation is fail closed and cannot start runtime or alter business configuration", () => {
  assert.match(migration, /account_runtime_active/);
  assert.match(migration, /runtime_assignment_not_ready/);
  assert.match(migration, /restriction_hold_active/);
  assert.match(migration, /blocking_dashboard_action_active/);
  assert.match(migration, /blocking_incident_active/);
  assert.match(migration, /'runtime_started', false/);
  assert.match(migration, /'schedule_changed', false/);
  assert.match(migration, /'package_changed', false/);
  assert.match(migration, /'target_changed', false/);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.account_run_requests/i);
  assert.doesNotMatch(migration, /update\s+public\.ig_targets/i);
});

test("only older login-specific failures are superseded", () => {
  assert.match(migration, /created_at <= v_client\.login_identity_verified_at/);
  assert.match(migration, /auto_login_failed/);
  assert.match(migration, /login_identity_mismatch/);
  assert.doesNotMatch(migration, /incident_type in[\s\S]*instagram_account_restriction/);
});

test("new functions are service-role only and rollback restores the certified operator implementation", () => {
  assert.match(migration, /revoke all on function public\.reconcile_connected_instagram_growth_readiness_v1\(uuid,text\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.reconcile_connected_instagram_growth_readiness_v1\(uuid,text\)[\s\S]*to service_role/);
  assert.match(rollback, /rename to confirm_instagram_login_operator_v1/);
  assert.match(rollback, /drop function if exists public\.reconcile_connected_instagram_growth_readiness_v1/);
});
