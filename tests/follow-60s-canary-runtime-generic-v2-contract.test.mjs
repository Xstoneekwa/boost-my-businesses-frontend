import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260801123500_follow_60s_canary_runtime_generic_v2.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../supabase/rollback/20260801123500_follow_60s_canary_runtime_generic_v2.down.sql", import.meta.url),
  "utf8",
);
const sqlTest = readFileSync(
  new URL("../supabase/tests/follow-60s-canary-runtime-generic-v2.sql", import.meta.url),
  "utf8",
);

test("generic binder has no compiled account identity and requires every binding claim", () => {
  assert.doesNotMatch(migration, /b024e94e|dfe78a92|ba73eda4|rex_gen|lorielebras|j_automatise/i);
  for (const parameter of [
    "p_control_id uuid",
    "p_account_id uuid",
    "p_expected_worker_sha text",
    "p_baseline_release_sha text",
    "p_run_request_id uuid",
    "p_run_id uuid",
    "p_attempt_id integer",
    "p_business_session_id text",
    "p_binding_version text",
  ]) {
    assert.match(migration, new RegExp(parameter));
  }
  assert.match(migration, /where c\.metadata_safe->>'control_id' = p_control_id::text/);
  assert.match(migration, /v_control\.account_id is distinct from p_account_id/);
});

test("binder is fail closed, single-consumption and transactionally locked", () => {
  for (const reason of [
    "control_not_found",
    "control_not_armed",
    "control_expired",
    "control_revoked",
    "active_control_collision",
    "account_mismatch",
    "worker_sha_mismatch",
    "baseline_release_mismatch",
    "request_mismatch",
    "run_mismatch",
    "attempt_mismatch",
    "business_session_mismatch",
    "binding_already_consumed",
    "max_cycles_reached",
  ]) {
    assert.match(migration, new RegExp(`raise exception '${reason}'`));
  }
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /runtime_binding_consumed', true/);
  assert.match(migration, /update public\.follow_60s_canary_controls/);
  assert.equal((migration.match(/update public\.follow_60s_canary_controls/g) ?? []).length, 1);
});

test("security boundary is service-role only and RLS remains covered", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.match(sqlTest, /has_function_privilege\('public'/);
  assert.match(sqlTest, /has_function_privilege\('anon'/);
  assert.match(sqlTest, /has_function_privilege\('authenticated'/);
  assert.match(sqlTest, /has_function_privilege\('service_role'/);
  assert.match(sqlTest, /relrowsecurity/);
});

test("switch fixtures prove four account identities without changing SQL code", () => {
  for (const suffix of ["000000000001", "000000000002", "000000000003", "000000000004"]) {
    assert.match(sqlTest, new RegExp(`10000000-0000-0000-0000-${suffix}`));
  }
  assert.match(sqlTest, /active_control_collision/);
  assert.match(sqlTest, /binding_already_consumed/);
});

test("rollback is narrowly scoped and restores only the predecessor signature", () => {
  assert.match(rollback, /drop function if exists public\.bind_follow_60s_canary_runtime_v2/);
  assert.match(rollback, /create function public\.bind_follow_60s_canary_runtime_v2/);
  assert.doesNotMatch(rollback, /drop table|truncate|delete from/i);
});
