import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migration = fs.readFileSync(path.join(
  root,
  "supabase/migrations/20260819203428_incident_resolution_generation_auto_restart_v1.sql",
), "utf8");
const route = fs.readFileSync(path.join(
  root,
  "app/api/instagram-dashboard/incidents/action/route.ts",
), "utf8");
const restartData = fs.readFileSync(path.join(
  root,
  "app/instagram-dashboard/auto-restart-data.ts",
), "utf8");

test("resolution uses the generation-aware V3 contract", () => {
  assert.match(route, /transition_account_incident_human_review_v3/);
  assert.match(route, /incident_human_review_action_v3/);
  assert.match(migration, /account_id = v_anchor\.account_id/);
  assert.match(migration, /i\.incident_type = v_anchor\.incident_type/);
  assert.match(migration, /v_normalized_reason/);
  assert.match(migration, /left\(lower\(coalesce\(i\.incident_type/);
  assert.match(migration, /not in \('true', '1', 'yes'\)/);
});

test("generation resolution restores runtime without schedule, run, or tick mutation", () => {
  assert.match(migration, /restore_resolved_operator_review_runtime_v3/);
  assert.match(migration, /'schedule_changed', false/);
  assert.match(migration, /'run_created', false/);
  assert.match(migration, /'tick_created', false/);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.account_run_requests/i);
  assert.doesNotMatch(migration, /update\s+public\.account_schedule_assignments/i);
});

test("manual stop command state is never a persistent Auto Restart blocker", () => {
  assert.doesNotMatch(
    restartData,
    /blockingReasons\.push\(["']manual_stop_requested["']\)/,
  );
  assert.match(restartData, /canonicalOperatorStopContinuationAuthorized/);
  assert.match(restartData, /freshBoundaryOnly: operatorStopContinuation/);
});
