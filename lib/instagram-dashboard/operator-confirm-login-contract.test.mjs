import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260810173000_operator_confirmed_login_readiness_v1.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../../supabase/rollback/20260810173000_operator_confirmed_login_readiness_v1.down.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/instagram-dashboard/readiness/now/route.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("./confirm-login-readiness.ts", import.meta.url), "utf8");
const clientRoute = readFileSync(new URL("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts", import.meta.url), "utf8");
const clientConnect = readFileSync(new URL("../instagram-client/connect-account.ts", import.meta.url), "utf8");

test("CONFIRM_LOGIN_REQUIRES_OPERATOR_AUTH", () => {
  assert.match(route, /requireRelayOrAdmin/);
  assert.match(route, /operator_identity_required/);
  assert.match(route, /operator_confirmation/);
  assert.doesNotMatch(clientRoute, /operator_confirmation|confirm_instagram_login_operator_v1/);
});

test("CONFIRM_LOGIN_REVALIDATES_ASSIGNMENT", () => {
  assert.match(migration, /account_assignments[\s\S]*phone_devices[\s\S]*phone_app_instances/);
  assert.match(migration, /v_instance\.device_id is distinct from v_assignment\.device_id/);
  assert.match(migration, /account_package_runtime_contract_status/);
});

test("CONFIRM_LOGIN_CREATES_OPERATOR_VERIFIED_PROOF", () => {
  for (const token of [
    "verification_source = 'operator'",
    "verification_method = 'manual_phone_review'",
    "login_identity_verified_by",
    "login_identity_verified_device_id",
    "login_identity_verified_app_instance_id",
    "login_identity_verified_assignment_id",
  ]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("CONFIRM_LOGIN_RECOMPUTES_READINESS", () => {
  assert.match(service, /runReadinessNow/);
  assert.match(migration, /credentials_not_ready|no_eligible_ct|other_blocking_dashboard_action/);
  assert.match(migration, /if v_blocker is not null[\s\S]*'ready', false/);
});

test("CONFIRM_LOGIN_RESOLVES_INCIDENT", () => {
  assert.match(migration, /v_resolution := public\.transition_account_incident_human_review_v2/);
  assert.match(migration, /p_action := 'resolve'/);
  assert.match(migration, /operator_confirmation_linked_incident_not_terminalized/);
  assert.doesNotMatch(service, /transition_account_incident_human_review_v2/);
});

test("CONFIRM_LOGIN_TERMINALIZES_DASHBOARD_ACTION", () => {
  assert.match(service, /dashboard_action_resolved/);
  assert.match(migration, /sync_account_dashboard_actions_from_status/);
});

test("CONFIRM_LOGIN_CREATES_RESUME_AUTHORIZATION", () => {
  assert.match(service, /resume_authorization_created/);
  assert.match(service, /next_tick_eligible/);
});

test("CONFIRM_LOGIN_DOES_NOT_START_RUN", () => {
  assert.doesNotMatch(service, /create_account_run_request|enqueue|start_run/);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.account_run_requests/i);
  assert.match(service, /run_started: false/);
});

test("DOUBLE_CONFIRM_IS_IDEMPOTENT", () => {
  assert.match(migration, /operator_proof_already_current/);
  assert.match(migration, /v_idempotent/);
  assert.match(service, /p_idempotency_key/);
});

test("BOTAPP_ADMIN_CLIENT_PARITY", () => {
  assert.match(service, /runReadinessNow/);
  assert.match(clientConnect, /runReadinessNow/);
  assert.match(clientConnect, /audience: "client"/);
  assert.doesNotMatch(clientRoute, /operator_confirmation|confirm_instagram_login_operator_v1/);
});

test("service-role-only grants and rollback are complete", () => {
  assert.match(migration, /revoke all on function public\.confirm_instagram_login_operator_v1[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.confirm_instagram_login_operator_v1[\s\S]*to service_role/i);
  assert.match(rollback, /drop function if exists public\.confirm_instagram_login_operator_v1/);
  assert.match(rollback, /drop column if exists login_identity_verification_source/);
});
