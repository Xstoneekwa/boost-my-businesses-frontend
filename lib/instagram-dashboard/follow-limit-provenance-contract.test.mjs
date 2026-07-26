import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260726200000_follow_limit_provenance_welcome_scheduler_observability_v1.sql", import.meta.url),
  "utf8",
);
const settingsRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/settings/route.ts", import.meta.url),
  "utf8",
);

test("no provenance row means package inheritance while explicit and ambiguous legacy values remain distinct", () => {
  assert.match(migration, /classification in \('explicit','legacy_unclassified'\)/);
  assert.match(migration, /when v_policy\.account_id is null then 'package_inherited'/);
  assert.match(migration, /'legacy_unclassified'/);
  assert.match(migration, /current_lower_value_without_provenance/);
  assert.match(settingsRoute, /overrideClassification === "explicit"/);
  assert.match(settingsRoute, /overrideClassification === "legacy_unclassified"/);
});

test("explicit cap saves are atomic with provenance and package-equal values clear the override", () => {
  assert.match(migration, /create or replace function public\.set_account_follow_limit_override_v1/);
  assert.match(migration, /p_follow_day_cap = v_package_day and p_follow_session_cap = v_package_session/);
  assert.match(migration, /delete from public\.ig_account_follow_limit_overrides/);
  assert.match(migration, /classification = 'explicit'/);
  assert.match(settingsRoute, /rpc\("set_account_follow_limit_override_v1"/);
});

test("package reconciliation reapplies provenance and Warmup never writes the override table", () => {
  assert.match(migration, /reconcile_account_package_runtime_contract_legacy_limit_restore_v1/);
  assert.match(migration, /apply_account_follow_limit_provenance_v1\(p_account_id\)/);
  assert.match(migration, /Warmup never writes here/);
  assert.doesNotMatch(migration, /update public\.account_warmup_settings/);
});

test("new service-only tables and functions revoke browser roles", () => {
  for (const objectName of [
    "ig_account_follow_limit_overrides",
    "schedule_session_cron_runs",
  ]) {
    assert.match(migration, new RegExp(`revoke all on table public\\.${objectName} from public, anon, authenticated`));
  }
  for (const functionName of [
    "apply_account_follow_limit_provenance_v1",
    "set_account_follow_limit_override_v1",
    "resolve_welcome_template_missing_incidents_v1",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${functionName}`));
  }
});
