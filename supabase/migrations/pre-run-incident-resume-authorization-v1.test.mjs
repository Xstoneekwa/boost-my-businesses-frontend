import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("./20260815021500_pre_run_incident_resume_authorization_v1.sql", import.meta.url), "utf8");
const rearm = readFileSync(new URL("./20260815030500_pre_run_incident_resume_rearm_v1.sql", import.meta.url), "utf8");

test("pre-run recovery is generic, lineage-bound, and preserves consumed history", () => {
  assert.match(migration, /q\.status = 'failed'/);
  assert.match(migration, /q\.run_id is null/);
  assert.match(migration, /q\.source_surface = 'auto_restart_tick'/);
  assert.match(migration, /old_auth\.status = 'consumed'/);
  assert.match(migration, /old_auth\.consumed_by_request_id = q\.id/);
  assert.match(migration, /old_auth\.resume_plan_id = p\.id/);
  assert.match(migration, /old_auth\.run_id = p\.run_id/);
  assert.match(migration, /current_auth\.id <> old_auth\.id/);
  assert.match(migration, /restart_block_reason = ''/);
  assert.doesNotMatch(migration, /restart_block_reason = null/i);
  assert.match(migration, /left\(lower\(coalesce\(i\.incident_type, ''\)\), 9\) <> 'security_'/);
  assert.match(migration, /original_schedule_key_preserved/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.incident_resume_authorizations/i);
  assert.doesNotMatch(migration, /rex_gen_boost_ai|nab_youss/i);
});

test("natural tick reconciliation includes the pre-run repair exactly before enrichment", () => {
  assert.match(migration, /v_pre_run := public\.reconcile_resolved_pre_run_incident_authorizations_v1\(\)/);
  assert.match(migration, /grant execute on function public\.reconcile_resolved_pre_run_incident_authorizations_v1\(\)\s+to service_role/);
});

test("the forward re-arm is generic, window-bound, and never revives consumed history", () => {
  assert.match(rearm, /a\.armed_source = 'resolved_pre_run_incident_reconciliation'/);
  assert.match(rearm, /a\.status = 'expired'/);
  assert.match(rearm, /a\.consumed_at is null/);
  assert.match(rearm, /a\.expires_at > now\(\)/);
  assert.match(rearm, /aa\.starts_at <= now\(\)/);
  assert.match(rearm, /now\(\) < aa\.ends_at/);
  assert.match(rearm, /status = 'armed'/);
  assert.doesNotMatch(rearm, /rex_gen_boost_ai|nab_youss/i);
});
