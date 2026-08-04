import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260804195414_follow60_canonical_effective_follow_limit_v1.sql", import.meta.url),
  "utf8",
);

test("constructor no longer contains the legacy global target 50 ceiling", () => {
  assert.doesNotMatch(migration, /p_baseline_follow_count\s*\+\s*p_max_new_cycles\s*>\s*50/);
  assert.doesNotMatch(migration, /canonical_follow_limit[^\n]*p_/i);
});

test("effective Follow cap is resolved server-side from Worker DB inputs", () => {
  assert.match(migration, /resolve_authoritative_follow_day_limit_v1/);
  assert.match(migration, /ig_account_settings/);
  assert.match(migration, /account_package_summary/);
  assert.match(migration, /effective_caps_preview\s*->>\s*'follow_day'/);
  assert.match(migration, /package_caps\s*->>\s*'follow_day'/);
  assert.match(migration, /least\(\s*v_configured_day,\s*v_effective_preview_day,\s*v_package_day/s);
});

test("unknown and exceeded limits fail closed before control mutation", () => {
  const resolveAt = migration.indexOf("v_limit_result :=");
  const selectControlAt = migration.indexOf("select * into v_existing");
  assert.ok(resolveAt > 0 && resolveAt < selectControlAt);
  assert.match(migration, /canonical_follow_limit_unresolved/);
  assert.match(migration, /canonical_follow_limit_exceeded/);
  assert.match(migration, /v_requested_target\s*>\s*v_canonical_follow_limit/);
});

test("identity, business date, idempotence and collision gates remain mandatory", () => {
  assert.match(migration, /baseline->>'worker_sha'/);
  assert.match(migration, /baseline->>'release_sha'/);
  assert.match(migration, /baseline->>'business_date'/);
  assert.match(migration, /p_business_date is distinct from v_current_business_date/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /idempotent_replay/);
  assert.match(migration, /same_account_active_control_collision/);
  assert.match(migration, /active_control_collision/);
});

test("new resolver and constructor are service-role only", () => {
  assert.match(migration, /revoke all on function public\.resolve_authoritative_follow_day_limit_v1[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.resolve_authoritative_follow_day_limit_v1[\s\S]*to service_role/);
  assert.match(migration, /revoke all on function public\.create_or_rearm_follow_60s_canary_control_v1[\s\S]*from public,anon,authenticated/);
});
