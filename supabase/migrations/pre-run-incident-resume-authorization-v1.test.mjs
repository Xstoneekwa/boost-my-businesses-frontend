import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("./20260815021500_pre_run_incident_resume_authorization_v1.sql", import.meta.url), "utf8");

test("pre-run recovery is generic, lineage-bound, and preserves consumed history", () => {
  assert.match(migration, /q\.status = 'failed'/);
  assert.match(migration, /q\.run_id is null/);
  assert.match(migration, /q\.source_surface = 'auto_restart_tick'/);
  assert.match(migration, /old_auth\.status = 'consumed'/);
  assert.match(migration, /old_auth\.consumed_by_request_id = q\.id/);
  assert.match(migration, /old_auth\.resume_plan_id = p\.id/);
  assert.match(migration, /old_auth\.run_id = p\.run_id/);
  assert.match(migration, /current_auth\.id <> old_auth\.id/);
  assert.match(migration, /left\(lower\(coalesce\(i\.incident_type, ''\)\), 9\) <> 'security_'/);
  assert.match(migration, /original_schedule_key_preserved/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.incident_resume_authorizations/i);
  assert.doesNotMatch(migration, /rex_gen_boost_ai|nab_youss/i);
});

test("natural tick reconciliation includes the pre-run repair exactly before enrichment", () => {
  assert.match(migration, /v_pre_run := public\.reconcile_resolved_pre_run_incident_authorizations_v1\(\)/);
  assert.match(migration, /grant execute on function public\.reconcile_resolved_pre_run_incident_authorizations_v1\(\)\s+to service_role/);
});
