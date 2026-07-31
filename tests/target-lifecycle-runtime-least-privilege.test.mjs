import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260731180200_target_lifecycle_runtime_service_role_least_privilege_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

const runtimeTables = [
  "ct_target_lifecycle_runtime_state",
  "ct_target_lifecycle_processing_checkpoints",
  "ct_target_lifecycle_pipeline_metrics",
  "ct_target_lifecycle_alert_events",
  "ct_target_lifecycle_cap_counters",
  "ct_target_lifecycle_pipeline_leases",
];

test("Lifecycle runtime direct grants are service_role read-only", () => {
  assert.match(
    migration,
    /from public, anon, authenticated, service_role;/i,
  );
  assert.match(migration, /grant select on table[\s\S]*to service_role;/i);
  assert.doesNotMatch(
    migration,
    /grant\s+(?:all|insert|update|delete|truncate)[\s\S]*to\s+service_role/i,
  );

  for (const table of runtimeTables) {
    assert.match(migration, new RegExp(`public\\.${table}\\b`));
  }
});
