import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260812193216_app_instance_prelogin_launchability_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../rollback/20260812193216_app_instance_prelogin_launchability_v1.down.sql", import.meta.url),
  "utf8",
);

test("identity and review gates remain launchable for login provisioning", () => {
  for (const reason of [
    "identity_required_unverified",
    "identity_mismatch",
    "review_required",
    "challenge_pending",
    "verification_required",
  ]) {
    assert.match(migration, new RegExp(`'${reason}'`));
  }
  assert.match(migration, /status in \('available', 'occupied'\)/);
  assert.match(migration, /is_launchable = true/);
  assert.match(migration, /usable_for_auto_login = true/);
  assert.match(migration, /'login_provisioning_allowed', true/);
  assert.match(migration, /'business_runtime_allowed', false/);
});

test("technical blockers and replaced instances cannot be reconciled", () => {
  assert.match(migration, /'legacy_pre_reprovision'/);
  assert.match(migration, /replaced_by_app_instance_id/);
  for (const blocker of [
    "maintenance",
    "corrupt",
    "removed",
    "package_missing",
    "version_prohibited",
  ]) {
    assert.match(migration, new RegExp(`'${blocker}'`));
  }
  assert.match(migration, /pd\.retired_at is null/);
  assert.match(migration, /nullif\(trim\(coalesce\(pai\.package_name/);
  assert.match(migration, /nullif\(trim\(coalesce\(pai\.launch_activity/);
});

test("reconciliation requires the exact live assignment and is generic", () => {
  assert.match(migration, /aa\.app_instance_id = pai\.id/);
  assert.match(migration, /aa\.account_id = pai\.current_account_id/);
  assert.match(migration, /aa\.released_at is null/);
  assert.match(migration, /aa\.status in \('reserved', 'active'\)/);
  assert.doesNotMatch(migration, /bmybusinesses|2cd8e47f|191e2c8c|clone\s*=\s*3/i);
});

test("future writes cannot reintroduce identity-driven technical disablement", () => {
  assert.match(migration, /phone_app_instances_business_gate_launchability_v1/);
  assert.match(migration, /not valid/);
  assert.match(migration, /validate constraint phone_app_instances_business_gate_launchability_v1/);
});

test("RPCs are service-role only and rollback does not re-disable instances", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.match(rollback, /Deliberately do not re-disable reconciled instances/);
  assert.doesNotMatch(rollback, /update public\.phone_app_instances/i);
});
