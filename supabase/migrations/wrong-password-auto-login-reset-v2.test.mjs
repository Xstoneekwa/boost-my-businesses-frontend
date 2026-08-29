import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./20260829212517_wrong_password_auto_login_reset_v2.sql", import.meta.url),
  "utf8",
);

test("reset V2 is service-role-only, transactional and fail-closed", () => {
  assert.match(sql, /^begin;/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /for update/);
  assert.match(sql, /account_runtime_active/);
  assert.match(sql, /account_device_lock_active/);
  assert.match(sql, /auto_restart_tick_active/);
  assert.match(sql, /active_instagram_credential_singleton_required/);
  assert.match(sql, /login_action_terminal_attempt_not_proven/);
  assert.match(sql, /revoke all on function public\.reset_client_instagram_auto_login_workflow_v2[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.reset_client_instagram_auto_login_workflow_v2[\s\S]*to service_role/);
});

test("reset V2 reaches canonical pre-login state without creating runtime", () => {
  assert.match(sql, /onboarding_status = 'configured'/);
  assert.match(sql, /provisioning_status = 'login_pending'/);
  assert.match(sql, /login_status = 'pending'/);
  assert.match(sql, /login_identity_proof_status = 'required_unverified'/);
  assert.match(sql, /account_status = 'inactive'/);
  assert.match(sql, /current_run_status = 'idle'/);
  assert.match(sql, /'authentication_success', false/);
  assert.match(sql, /'runtime_started', false/);
  assert.match(sql, /'run_request_created', false/);
  assert.match(sql, /'tick_created', false/);
  assert.doesNotMatch(sql, /insert into public\.account_run_requests/i);
  assert.doesNotMatch(sql, /insert into public\.ig_runs/i);
  assert.doesNotMatch(sql, /insert into public\.auto_restart_tick_locks/i);
});

test("reset V2 preserves account, commercial, assignment, target, credential and terminal history", () => {
  for (const table of [
    "client_subscriptions",
    "commercial_entitlements",
    "account_package_runtime_contract_status",
    "ig_targets",
    "account_protection_list_entries",
    "account_assignments",
    "phone_devices",
    "phone_app_instances",
    "account_schedules",
    "account_run_requests",
    "ig_runs",
  ]) {
    assert.doesNotMatch(sql, new RegExp(`(?:update|delete\\s+from|insert\\s+into)\\s+public\\.${table}`, "i"));
  }
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(?:ig_accounts|client_instagram_accounts|account_credentials)/i);
  assert.doesNotMatch(sql, /status\s*=\s*'superseded'[\s\S]*account_credentials/i);
  assert.match(sql, /where id = v_active_credential_id/);
  assert.match(sql, /'active_credential_count', 1/);
  assert.match(sql, /'credential_history_changed', false/);
});

test("reset V2 archives historical failures and dismisses modern actions without false success", () => {
  assert.match(sql, /incident_type in \([\s\S]*'auto_login_failed'[\s\S]*'login_package_mismatch'/);
  assert.match(sql, /archived_at = coalesce\(i\.archived_at, v_now\)/);
  assert.doesNotMatch(sql, /set status = 'resolved'[\s\S]*account_incidents/i);
  assert.match(sql, /action_type in \([\s\S]*'update_instagram_password'[\s\S]*'review_login_package_mismatch'[\s\S]*'login_preflight_scheduled'/);
  assert.match(sql, /status = 'dismissed'/);
  assert.match(sql, /'password_verification_result'[\s\S]*'not_verified_reset_to_preconnect'/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.account_incidents/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.account_dashboard_actions/i);
});

test("package-mismatch and password actions require terminal-attempt proof", () => {
  assert.match(sql, /action_type in \('update_instagram_password', 'review_login_package_mismatch'\)/);
  assert.match(sql, /join public\.ig_runs r on r\.id = i\.run_id/);
  assert.match(sql, /r\.started_at <= a\.created_at/);
  assert.match(sql, /r\.finished_at >= a\.created_at/);
  assert.match(sql, /q\.created_at <= a\.created_at/);
  assert.match(sql, /q\.completed_at >= a\.created_at/);
});

test("second reset is a logical no-op while retaining immutable audit", () => {
  assert.match(sql, /where account_id = p_account_id[\s\S]*onboarding_status is distinct from 'configured'/);
  assert.match(sql, /reauth_required is distinct from true/);
  assert.match(sql, /status is distinct from 'inactive'/);
  assert.match(sql, /status in \('pending', 'acknowledged', 'pending_verification', 'code_submitted'\)/);
  assert.match(sql, /'state_changed', \(v_projection_rows \+ v_actions_dismissed \+ v_incidents_archived\) > 0/);
  assert.match(sql, /insert into public\.ig_action_logs/);
});
