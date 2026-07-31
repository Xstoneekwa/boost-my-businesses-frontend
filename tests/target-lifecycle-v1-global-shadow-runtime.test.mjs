import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260731161623_target_lifecycle_v1_global_shadow_runtime_v1.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../supabase/rollback/20260731161623_target_lifecycle_v1_global_shadow_runtime_v1.down.sql", import.meta.url), "utf8");
const pipeline = readFileSync(new URL("../lib/target-lifecycle/runtime-pipeline.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../lib/target-lifecycle/global-shadow-engine.ts", import.meta.url), "utf8");
const cronRoute = readFileSync(new URL("../app/api/cron/target-lifecycle/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const migrationVersion = "20260731161623";

test("migration is ordered after the certified production head and remains additive to business tables", () => {
  assert.ok(Number(migrationVersion) > 20260731154709);
  assert.match(migration, /20260731154709|Target Lifecycle V1 global Shadow/);
  assert.doesNotMatch(migration, /(?:update|delete\s+from|truncate)\s+public\.ig_targets\b/i);
  assert.doesNotMatch(migration, /(?:update|delete\s+from|truncate)\s+public\.client_account_notifications\b/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ct_proposals\b/i);
  assert.doesNotMatch(migration, /(?:insert\s+into|update|delete\s+from)\s+public\.ct_target_replacement_links\b/i);
});

test("database contract is service-role-only, FORCE RLS and structurally shadow-only", () => {
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke all on table public\.%I from public,anon,authenticated/i);
  assert.match(migration, /revoke all on function %s from public,anon,authenticated/i);
  assert.match(migration, /ct_target_lifecycle_runtime_shadow_only_check/);
  assert.match(migration, /ct_target_lifecycle_assessments_shadow_only_v1_check/);
  assert.match(migration, /enforcement_allowed is false and business_action_allowed is false and mutation_executed is false/);
});

test("persistence is idempotent, account scoped and protects current from older versions/events", () => {
  assert.match(migration, /on conflict\(tenant_id,account_id,target_id,assessment_key\) do nothing/i);
  assert.match(migration, /cia\.client_id=v_tenant_id and cia\.account_id=v_account_id/);
  assert.match(migration, /t\.id=v_target_id and t\.account_id=v_account_id/);
  assert.match(migration, /v_existing_engine_revision,0\)>v_engine_revision/);
  assert.match(migration, /v_existing_policy_revision,0\)>v_policy_revision/);
  assert.match(migration, /v_existing_source_at>v_source_at/);
  assert.match(migration, /out_of_order_skipped/);
  assert.match(migration, /version_regression_skipped/);
  assert.match(migration, /performance_skips/);
  assert.match(migration, /ct_target_evaluation_events/);
});

test("runtime caller is bounded, retry-limited and cannot invoke business actions", () => {
  assert.match(pipeline, /batchSize: 25/);
  assert.match(pipeline, /retries: 1/);
  assert.match(pipeline, /business_actions: 0, notifications: 0, archives: 0, replacements: 0/);
  assert.doesNotMatch(pipeline, /from\(["']ig_targets["']\)\.(?:update|delete|upsert|insert)/);
  assert.doesNotMatch(pipeline, /client_account_notifications|ct_proposals|ct_target_replacement_links|sendEmail|archiveTarget/);
  assert.match(engine, /BUSINESS_ACTION_GATE = false as const/);
  assert.match(engine, /businessActionAllowed: BUSINESS_ACTION_GATE/);
  assert.match(engine, /enforcementAllowed: BUSINESS_ACTION_GATE/);
  assert.match(pipeline, /target_lifecycle_business_action_detected/);
  assert.match(pipeline, /target_lifecycle_version_divergence/);
  assert.match(pipeline, /target_lifecycle_unbounded_volume/);
});

test("cron is authenticated, independent of Instagram runs and globally scheduled", () => {
  assert.match(cronRoute, /process\.env\.CRON_SECRET/);
  assert.match(cronRoute, /authorization/);
  assert.doesNotMatch(cronRoute, /account_run_requests|ig_runs|auto_restart|ADB|device/);
  assert.ok(vercel.crons.some((row) => row.path === "/api/cron/target-lifecycle" && row.schedule === "* * * * *"));
});

test("rollback removes runtime without deleting retained lifecycle rows", () => {
  assert.match(rollback, /drop function if exists public\.persist_target_lifecycle_shadow_v1/);
  assert.match(rollback, /drop table if exists public\.ct_target_lifecycle_runtime_state/);
  assert.doesNotMatch(rollback, /delete\s+from\s+public\.ct_target_lifecycle_assessments/i);
  assert.doesNotMatch(rollback, /truncate/i);
});
