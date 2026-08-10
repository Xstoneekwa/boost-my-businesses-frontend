import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260810110000_internal_security_definer_service_role_only_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../rollback/20260810110000_internal_security_definer_service_role_only_v1.down.sql", import.meta.url),
  "utf8",
);

const protectedFunctions = [
  "_device_ui_lease_audit",
  "acquire_device_ui_lease",
  "assign_account_manual_only",
  "auto_restart_bind_device_lock_to_request",
  "auto_restart_release_device_lock",
  "auto_restart_renew_device_lock",
  "auto_restart_transfer_device_lock",
  "backfill_ig_target_followbacks",
  "bind_scheduled_session_preflight_request",
  "claim_next_dm_job",
  "complete_scheduled_session_preflight",
  "enqueue_outreach_dm_job",
  "enqueue_welcome_dm_job_if_eligible",
  "evaluate_account_schedule_gate",
  "get_active_operator_stop_suppression",
  "get_valid_scheduled_session_preflight",
  "handle_new_user",
  "handoff_preflight_device_lock_to_request",
  "mark_dm_job_running",
  "reconcile_stale_device_ui_leases",
  "release_device_ui_lease",
  "release_dm_job_after_dry_run",
  "renew_device_ui_lease",
  "rls_auto_enable",
  "sync_client_subscription_entitlements",
  "sync_ig_account_target_followbacks",
  "sync_ig_target_followbacks_count",
  "upsert_account_follower_seen",
  "upsert_operator_stop_suppression",
  "upsert_scheduled_session_preflight",
];

test("all exposed internal SECURITY DEFINER functions become service-role only", () => {
  assert.equal(protectedFunctions.length, 30);
  for (const functionName of protectedFunctions) {
    assert.match(migration, new RegExp(`public\\.${functionName}\\s*\\(`, "i"));
  }
  assert.match(migration, /revoke execute on function[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role;/i);
});

test("the ACL correction cannot rewrite functions or business rows", () => {
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(migration, /\b(insert|update|delete|truncate)\b/i);
});

test("rollback documents every protected function and restores the prior browser grants", () => {
  for (const functionName of protectedFunctions) {
    assert.match(rollback, new RegExp(`public\\.${functionName}\\s*\\(`, "i"));
  }
  assert.match(rollback, /to public, anon, authenticated;/i);
  assert.match(rollback, /sync_client_subscription_entitlements\(uuid\) to anon;/i);
});
