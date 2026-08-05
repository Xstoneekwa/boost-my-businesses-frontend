import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260805110000_account_operational_projection_reconciliation_v1.sql", import.meta.url),
  "utf8",
);

test("operational projection reconciliation is service-role-only and fail-closed", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /service_role_required/);
  assert.match(migration, /from public\.instagram_account_restriction_holds/);
  assert.match(migration, /blocking_dashboard_action_active/);
  assert.match(migration, /blocking_incident_active/);
  assert.match(migration, /account_runtime_active/);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
});

test("operational projection reconciliation changes no package, phase, cap, schedule, checkpoint, or protection data", () => {
  assert.match(migration, /update public\.ig_accounts[\s\S]*set status = 'active'/);
  assert.match(migration, /update public\.ig_account_settings[\s\S]*account_status = 'active'[\s\S]*current_run_status = 'idle'/);
  assert.doesNotMatch(migration, /update public\.account_assignments/);
  assert.doesNotMatch(migration, /update public\.account_package/);
  assert.doesNotMatch(migration, /update public\.account_session_resume/);
  assert.doesNotMatch(migration, /update public\.account_protection/);
  assert.doesNotMatch(migration, /follow_enabled\s*=/);
  assert.doesNotMatch(migration, /welcome_enabled\s*=/);
  assert.doesNotMatch(migration, /unfollow_enabled\s*=/);
  assert.doesNotMatch(migration, /follow_limit\s*=/);
  assert.doesNotMatch(migration, /max_actions_per_day\s*=/);
});
