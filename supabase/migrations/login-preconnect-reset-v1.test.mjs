import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./20260811170000_login_preconnect_reset_v1.sql", import.meta.url),
  "utf8",
);

test("pre-login reset is service-role-only and cannot start runtime", () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function public\.reset_client_instagram_login_to_preconnect_v1[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.reset_client_instagram_login_to_preconnect_v1[\s\S]*to service_role/);
  assert.match(sql, /account_runtime_active/);
  assert.match(sql, /'runtime_started', false/);
  assert.doesNotMatch(sql, /insert into public\.account_run_requests/i);
  assert.doesNotMatch(sql, /insert into public\.ig_runs/i);
});

test("pre-login reset clears identity proof and restores canonical connect state", () => {
  assert.match(sql, /onboarding_status = 'configured'/);
  assert.match(sql, /provisioning_status = 'login_pending'/);
  assert.match(sql, /login_status = 'pending'/);
  assert.match(sql, /login_identity_proof_status = 'required_unverified'/);
  assert.match(sql, /login_identity_verified_at = null/);
  assert.match(sql, /login_identity_login_lineage = '\{\}'::jsonb/);
  assert.match(sql, /reauth_reason = 'awaiting_login_verification'/);
});

test("pre-login reset preserves commercial, targeting and assignment sources", () => {
  for (const table of [
    "client_subscriptions",
    "commercial_entitlements",
    "account_package_runtime_contract_status",
    "ig_targets",
    "account_protection_list_entries",
    "account_assignments",
    "phone_app_instances",
    "account_schedules",
  ]) {
    assert.doesNotMatch(sql, new RegExp(`(?:update|delete\\s+from|insert\\s+into)\\s+public\\.${table}`, "i"));
  }
  assert.doesNotMatch(sql, /secret_ref\s*=/i);
  assert.match(sql, /'commercial_state_changed', false/);
  assert.match(sql, /'assignment_changed', false/);
  assert.match(sql, /'schedule_changed', false/);
  assert.match(sql, /'vault_secret_changed', false/);
});

test("pre-login reset retires only bounded login-attempt incidents and actions", () => {
  assert.match(sql, /incident_type in \([\s\S]*'email_verification_code_required'[\s\S]*'auto_login_identity_mismatch'/);
  assert.match(sql, /action_type in \([\s\S]*'enter_email_verification_code'[\s\S]*'enter_sms_verification_code'[\s\S]*'enter_whatsapp_verification_code'/);
  assert.match(sql, /status = 'dismissed'/);
  assert.match(sql, /blocking_campaign = false/);
  assert.match(sql, /incident_type = 'account_login_required'/);
  assert.match(sql, /Auto Restart-eligible incident family/);
  assert.match(sql, /'auto_resume_armed', false/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.account_incidents/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.account_dashboard_actions/i);
});
