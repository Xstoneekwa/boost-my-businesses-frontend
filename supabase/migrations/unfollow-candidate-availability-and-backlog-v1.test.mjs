import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260728211139_unfollow_candidate_availability_and_backlog_v1.sql", import.meta.url),
  "utf8",
);

const privilegeFix = readFileSync(
  new URL("./20260728211349_restrict_unfollow_candidate_availability_service_role_privileges_v1.sql", import.meta.url),
  "utf8",
);

test("not-found lifecycle is account scoped and exact-username only", () => {
  assert.match(migration, /primary key \(account_id, normalized_username\)/i);
  assert.match(migration, /lower\(btrim\(u\.username\)\) = v_username/i);
  assert.doesNotMatch(migration, /similarity\(|levenshtein|ilike/i);
});

test("one local run observation is idempotent and two observations exhaust", () => {
  assert.match(migration, /v_existing\.source_run_id = p_source_run_id/i);
  assert.match(migration, /v_attempt_count >= v_max_attempts then 'exhausted'/i);
  assert.match(migration, /make_interval\(hours => v_cooldown_hours\)/i);
});

test("Auto Restart counts only actionable strict Unfollow candidates", () => {
  assert.match(migration, /auto_restart_unfollow_backlog_v1/i);
  assert.match(migration, /backlog_actionable_remaining/i);
  assert.match(migration, /backlog_unavailable_remaining/i);
  assert.match(migration, /unfollow_whitelist/i);
  assert.match(migration, /lower\(btrim\(u\.username\)\) !~ '\^\\\.'/i);
  assert.match(migration, /lower\(btrim\(u\.username\)\) !~ '\\\.\$'/i);
  assert.match(migration, /lower\(btrim\(u\.username\)\) !~ '\\\.\\\.'/i);
});

test("table and RPCs are service-role only with RLS enabled", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(privilegeFix, /revoke all[\s\S]*from service_role/i);
  assert.match(privilegeFix, /grant select, insert, update[\s\S]*to service_role/i);
});
