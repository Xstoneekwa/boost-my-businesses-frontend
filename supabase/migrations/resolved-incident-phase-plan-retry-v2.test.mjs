import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("./20260727014500_resolved_incident_phase_plan_retry_v2.sql", import.meta.url), "utf8");

test("authorization consume and request creation are one transaction", () => {
  assert.match(sql, /consume_resume_authorization_and_create_request_v2/);
  assert.match(sql, /for update/);
  assert.match(sql, /create_account_run_request/);
  assert.match(sql, /consumed_by_request_id = v_request\.id/);
});

test("all auto-restart account sessions require an actionable V2 plan", () => {
  assert.match(sql, /AUTO_RESTART_RESUME_PLAN_V2/);
  assert.match(sql, /account_run_requests_auto_restart_phase_plan_v2/);
  assert.match(sql, /resume_phase_plan_not_actionable/);
  assert.match(sql, /phase_plan_quota_invalid/);
});

test("pre-business phase-plan failures restore exactly one retry generation", () => {
  assert.match(sql, /restore_prebusiness_resume_retry_credits_v1/);
  assert.match(sql, /phase_plan_unknown_zero_business_actions/);
  assert.match(sql, /retry_generation = retry_generation \+ 1/);
  assert.match(sql, /total_follow, 0\) = 0/);
  assert.match(sql, /total_like, 0\) = 0/);
  assert.match(sql, /total_dm, 0\) = 0/);
});

test("resolved incidents and later assignments use one generic reconciliation", () => {
  assert.match(sql, /reconcile_resolved_incident_resume_windows_v1/);
  assert.match(sql, /i\.status = 'resolved'/);
  assert.match(sql, /resolved_incident_reconciliation/);
  assert.doesNotMatch(sql, /rex_gen_boost_ai|b024e94e/);
});

test("sensitive RPCs are service-role only", () => {
  assert.match(sql, /revoke all on function public\.consume_resume_authorization_and_create_request_v2[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.consume_resume_authorization_and_create_request_v2[\s\S]*to service_role/);
  assert.match(sql, /revoke all on function public\.restore_prebusiness_resume_retry_credits_v1\(\)[\s\S]*from public, anon, authenticated/);
});
