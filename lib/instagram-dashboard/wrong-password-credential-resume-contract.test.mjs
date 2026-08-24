import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260825090000_wrong_password_credential_resume_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../../supabase/rollback/20260825090000_wrong_password_credential_resume_v1.down.sql", import.meta.url),
  "utf8",
);

test("password remediation requires an accepted active credential and exact identity proof", () => {
  assert.match(migration, /provider = 'instagram'/);
  assert.match(migration, /status = 'active'/);
  assert.match(migration, /reauth_required, false\) is false/);
  assert.match(migration, /login_identity_proof_status[\s\S]*verified/);
  assert.match(migration, /login_identity_profile_opened[\s\S]*is not true/);
  assert.match(migration, /login_identity_username_match[\s\S]*is not true/);
  assert.match(migration, /exact_login_identity_not_ready/);
  assert.match(migration, /accepted_active_credential_required/);
});

test("password remediation resolves only the canonical password action without starting runtime", () => {
  assert.match(migration, /action_type = 'update_instagram_password'/);
  assert.match(migration, /status in \('pending', 'acknowledged', 'pending_verification', 'code_submitted'\)/);
  assert.match(migration, /set status = 'resolved'/);
  assert.match(migration, /blocking_campaign = false/);
  assert.match(migration, /requires_client_action = false/);
  assert.match(migration, /'runtime_started', false/);
  assert.match(migration, /'commercial_state_changed', false/);
  assert.match(migration, /'schedule_changed', false/);
  assert.match(migration, /'target_changed', false/);
  assert.doesNotMatch(migration, /create_account_run_request/i);
});

test("password remediation is service-role only, idempotent, and rollbackable", () => {
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.reconcile_instagram_password_remediation_v1\(uuid,text\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.reconcile_instagram_password_remediation_v1\(uuid,text\)[\s\S]*to service_role/i);
  assert.match(migration, /'already_converged'/);
  assert.match(rollback, /drop trigger if exists client_instagram_password_remediation_v1/i);
  assert.match(rollback, /drop function if exists public\.reconcile_instagram_password_remediation_v1\(uuid,\s*text\)/i);
});
