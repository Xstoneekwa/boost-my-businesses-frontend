import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260810010000_unfollow_limit_provenance_and_canonical_onboarding_defaults_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../../supabase/rollback/20260810010000_unfollow_limit_provenance_and_canonical_onboarding_defaults_v1.down.sql", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../app/api/instagram-dashboard/settings/unfollow/route.ts", import.meta.url),
  "utf8",
);

test("Unfollow lower caps have explicit or preserved ambiguous provenance", () => {
  assert.match(migration, /create table if not exists public\.ig_account_unfollow_limit_overrides/);
  assert.match(migration, /classification in \('explicit', 'legacy_unclassified'\)/);
  assert.match(migration, /No row means package inheritance/);
  assert.match(migration, /source in \('admin', 'support', 'migration_confirmed', 'migration_unclassified'\)/);
});

test("canonical onboarding schema-default contamination is narrowly proven, never account hardcoded", () => {
  assert.match(migration, /s\.unfollow_per_session_limit = 50/);
  assert.match(migration, /client_instagram_onboarding_sessions/);
  assert.match(migration, /unfollow_domain_settings_saved/);
  assert.match(migration, /confirmed_human_settings_save/);
  assert.match(migration, /migration_confirmed/);
  assert.doesNotMatch(migration, /al\.created_at\s*<=\s*s\.updated_at/);
  assert.match(migration, /package_runtime_contract_reconciled/);
  assert.doesNotMatch(migration, /growth_with_bmb|8bdd2dde-6b14-4ca8-bd7b-bedf67302fc4/i);
});

test("canonical reconcile applies Unfollow provenance after existing Follow provenance", () => {
  assert.match(migration, /to_regprocedure\('public\.reconcile_account_package_runtime_contract_follow_provenance_v1\(uuid,text\)'\) is null/);
  assert.match(migration, /rename to reconcile_account_package_runtime_contract_follow_provenance_v1/);
  assert.match(migration, /reconcile_account_package_runtime_contract_follow_provenance_v1\(p_account_id, p_source\)/);
  assert.match(migration, /apply_account_unfollow_limit_provenance_v1\(p_account_id\)/);
});

test("admin settings persist explicit Unfollow limits through the service-role RPC", () => {
  assert.match(route, /rpc\("set_account_unfollow_limit_override_v1"/);
  assert.match(route, /p_source_surface: "instagram_dashboard_settings"/);
  assert.match(migration, /revoke all on function public\.set_account_unfollow_limit_override_v1[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.set_account_unfollow_limit_override_v1[\s\S]*to service_role/);
});

test("RLS and rollback are explicit", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(rollback, /rename to reconcile_account_package_runtime_contract/);
  assert.match(rollback, /drop table if exists public\.ig_account_unfollow_limit_overrides/);
});
