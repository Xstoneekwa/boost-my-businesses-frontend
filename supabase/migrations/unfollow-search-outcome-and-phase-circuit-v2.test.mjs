import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260729200500_unfollow_search_outcome_and_phase_circuit_v2.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../rollback/20260729200500_unfollow_search_outcome_and_phase_circuit_v2.down.sql", import.meta.url),
  "utf8",
);

test("exact no-results and technical Search failures have distinct durable states", () => {
  assert.match(migration, /username_not_found_confirmed/);
  assert.match(migration, /search_surface_unhealthy/);
  assert.match(migration, /terminal_preserved/);
  assert.match(migration, /next_retry_at/);
});

test("candidate outcome RPC is account-run bound and idempotent", () => {
  assert.match(migration, /record_unfollow_candidate_availability_v2/);
  assert.match(migration, /r\.id = p_source_run_id and r\.account_id = p_account_id/);
  assert.match(migration, /idempotent_replay/);
  assert.match(migration, /for update/);
});

test("phase breaker is Unfollow-only and does not mutate Follow settings", () => {
  assert.match(migration, /phase = 'unfollow'/);
  assert.match(migration, /unfollow_search_surface_consecutive_failure_limit_reached/);
  assert.doesNotMatch(migration, /follow_enabled\s*=/);
  assert.doesNotMatch(migration, /ig_account_follow_settings/);
});

test("phase breaker is bounded to two sessions per Johannesburg business date", () => {
  assert.match(migration, /session_count between 1 and 2/);
  assert.match(migration, /same_username_repeat_count/);
  assert.match(migration, /max_sessions_per_business_date', 2/);
  assert.match(
    migration,
    /business_date_sast \+ 1\)::timestamp[\s\S]*at time zone 'Africa\/Johannesburg'/,
  );
});

test("Auto Restart receives actionable terminal hold and circuit projections", () => {
  assert.match(migration, /auto_restart_unfollow_backlog_v2/);
  assert.match(migration, /backlog_actionable_remaining/);
  assert.match(migration, /backlog_terminal_unavailable/);
  assert.match(migration, /backlog_technical_hold/);
  assert.match(migration, /phase_circuit_open/);
  assert.match(migration, /phase_circuit_next_retry_at/);
});

test("business dates share the Johannesburg contract while timestamps stay timestamptz", () => {
  assert.match(migration, /at time zone 'Africa\/Johannesburg'/);
  assert.match(migration, /business_date_sast date/);
  assert.match(migration, /timestamptz/);
});

test("candidate classification never rewrites the historical interaction ledger", () => {
  assert.match(migration, /from public\.ig_interacted_users/);
  assert.doesNotMatch(migration, /update\s+public\.ig_interacted_users/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.ig_interacted_users/i);
  assert.doesNotMatch(migration, /truncate\s+(?:table\s+)?public\.ig_interacted_users/i);
});

test("both tables and all RPCs are service-role only", () => {
  assert.match(
    migration,
    /revoke all on table public\.ig_unfollow_candidate_availability[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on table public\.ig_unfollow_phase_circuit_breakers[\s\S]*from public, anon, authenticated/,
  );
  assert.equal(
    (migration.match(/revoke all on function public\./g) ?? []).length,
    3,
  );
  assert.equal(
    (migration.match(/grant execute on function public\./g) ?? []).length,
    3,
  );
});

test("rollback refuses to erase v2 history", () => {
  assert.match(rollback, /rollback_refused:v2_unfollow_search_history_present/);
  assert.match(rollback, /username_not_found_confirmed/);
  assert.match(rollback, /ig_unfollow_phase_circuit_breakers/);
});
