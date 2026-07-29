import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260729193000_follow_source_account_overrides_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../supabase/rollback/20260729193000_follow_source_account_overrides_v1.down.sql", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../app/api/instagram-dashboard/settings/follow-sources/route.ts", import.meta.url),
  "utf8",
);

test("source rotation values are positive account overrides bounded by the package", () => {
  assert.match(migration, /coalesce\(v_sources\.max_follows_per_target_per_run, 0\) <= 0/);
  assert.match(migration, /coalesce\(v_sources\.max_targets_per_run, 0\) <= 0/);
  assert.match(migration, /v_sources\.max_follows_per_target_per_run > v_runtime\.max_follows_per_target_per_run/);
  assert.match(migration, /v_sources\.max_targets_per_run > v_runtime\.max_targets_per_run/);
  assert.doesNotMatch(
    migration,
    /v_sources\.max_follows_per_target_per_run is distinct from v_runtime\.max_follows_per_target_per_run/,
  );
  assert.match(migration, /'rotation_override_policy', 'positive_account_override_lte_package'/);
});

test("reconciliation preserves only valid lower source overrides under an account lock", () => {
  assert.match(migration, /for update;[\s\S]*if not found then/);
  assert.match(migration, /v_restore_follows := v_before_follows between 1 and v_package_follows/);
  assert.match(migration, /v_restore_targets := v_before_targets between 1 and v_package_targets/);
  assert.match(migration, /v_before_updated_by text;/);
  assert.match(migration, /set_config\('bmb\.package_contract_reconcile', 'on', true\)/);
  assert.match(migration, /reconcile_package_runtime_contract_pre_source_override_v1/);
  assert.match(migration, /exception when others then[\s\S]*set_config\('bmb\.package_contract_reconcile', v_previous_guard, true\)/);
});

test("database functions remain service-role only and the migration is definition-only", () => {
  for (const functionName of [
    "account_package_runtime_contract_status",
    "reconcile_package_runtime_contract_pre_source_override_v1",
    "reconcile_account_package_runtime_contract",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${functionName}\\(uuid(?:, text)?\\)[\\s\\S]*from public, anon, authenticated`),
    );
  }
  assert.doesNotMatch(migration, /\n(?:insert into|delete from|truncate) public\./i);
  assert.match(migration, /^--[\s\S]*\nbegin;/);
  assert.match(migration, /\ncommit;\s*$/);
});

test("the API verifies the committed row before logging or returning success", () => {
  const rereadIndex = route.indexOf("await fetchFollowSourceSettingsRow(supabase, accountId)", route.indexOf("const { error }"));
  const mismatchIndex = route.indexOf("followSourceRotationPersistenceMismatch", rereadIndex);
  const auditIndex = route.indexOf("await recordAudit", mismatchIndex);
  assert.ok(rereadIndex > 0);
  assert.ok(mismatchIndex > rereadIndex);
  assert.ok(auditIndex > mismatchIndex);
  assert.match(route, /Follow source settings were not persisted:[\s\S]*409/);
});

test("the API exposes and enforces the canonical package rotation ceiling", () => {
  assert.match(route, /from\("commercial_package_runtime_settings"\)/);
  assert.match(route, /select\("max_follows_per_target_per_run,max_targets_per_run"\)/);
  assert.match(route, /max_follows_per_target_per_run_exceeds_package_ceiling/);
  assert.match(route, /max_targets_per_run_exceeds_package_ceiling/);
});

test("rollback restores package-exact readiness and the previous canonical reconciler", () => {
  assert.match(rollback, /drop function public\.reconcile_account_package_runtime_contract\(uuid, text\)/);
  assert.match(rollback, /rename to reconcile_account_package_runtime_contract/);
  assert.match(rollback, /is distinct from v_runtime\.max_follows_per_target_per_run/);
  assert.match(rollback, /is distinct from v_runtime\.max_targets_per_run/);
  assert.match(rollback, /follow_source_override_rollback_definition_mismatch/);
});
