import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("./20260801164753_resolved_incident_recovery_finalization_v2.sql", import.meta.url),
  "utf8",
);

test("resolved incidents finalize against the latest canonical run only", () => {
  assert.match(sql, /prepare_resolved_incident_recovery_v2/);
  assert.match(sql, /order by r\.created_at desc, r\.id desc/);
  assert.match(sql, /v_latest_run_id is distinct from v_incident\.run_id/);
  assert.match(sql, /resume_source_run_superseded/);
  assert.match(sql, /r\.id = \([\s\S]*select latest\.id[\s\S]*order by latest\.created_at desc, latest\.id desc/);
});

test("a missing latest plan becomes a cursor-free shell, never invented phases", () => {
  assert.match(sql, /RESOLVED_INCIDENT_PLAN_SHELL_V1/);
  assert.match(sql, /'business_phases_source', 'live_canonical_candidate_only'/);
  assert.match(sql, /'cursor_invented', false/);
  assert.match(sql, /resume_state, restart_allowed, restart_block_reason/);
  assert.match(sql, /'awaiting_human_resume_authorization', true,[\s\S]*'resolved_incident_live_plan_rebuild'/);
  assert.doesNotMatch(sql, /'phases_to_run'/);
  assert.doesNotMatch(sql, /'quota_remaining'/);
});

test("one current authorization is bounded by incident, window, and account", () => {
  assert.match(sql, /incident_resume_authorizations_one_per_incident_window/);
  assert.match(sql, /\(incident_id, resume_window_key\)/);
  assert.match(sql, /incident_resume_authorizations_one_armed_per_account/);
  assert.match(sql, /where status = 'armed'/);
  assert.match(sql, /a\.status in \('armed', 'consumed', 'expired'\)/);
});

test("resolution trigger and periodic reconciliation share the same finalizer", () => {
  assert.match(sql, /after update of status on public\.account_incidents/);
  assert.match(sql, /perform public\.prepare_resolved_incident_recovery_v2\(new\.id\)/);
  assert.match(sql, /v_result := public\.prepare_resolved_incident_recovery_v2\(v_row\.incident_id\)/);
  assert.match(sql, /select public\.reconcile_resolved_incident_resume_windows_v1\(\)/);
});

test("privileged functions are service-role only with empty search paths", () => {
  for (const name of [
    "prepare_resolved_incident_recovery_v2",
    "arm_incident_resolution_auto_resume_v1",
    "reconcile_resolved_incident_resume_windows_v1",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to service_role`));
  }
});

test("the repair cannot create a request, run, tick, or device action", () => {
  assert.doesNotMatch(sql, /create_account_run_request|insert into public\.account_run_requests/);
  assert.doesNotMatch(sql, /insert into public\.ig_runs|auto_restart_tick\(/);
  assert.doesNotMatch(sql, /adb|device_action/);
});
