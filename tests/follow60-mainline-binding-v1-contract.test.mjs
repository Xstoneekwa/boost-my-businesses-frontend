import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260804231500_follow60_mainline_binding_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../supabase/rollback/20260804231500_follow60_mainline_binding_v1.down.sql", import.meta.url),
  "utf8",
);

test("mainline is run-bound and cannot inherit an active canary barrier", () => {
  assert.match(migration, /p_binding_id is distinct from p_run_id/);
  assert.match(migration, /follow60_mainline_active_canary_collision/);
  assert.match(migration, /'max_cycles',0/);
  assert.match(migration, /'barrier_reached',false/);
  assert.match(migration, /'next_candidate_permitted',true/);
  assert.doesNotMatch(migration, /b024e94e|rex_gen_boost_ai|lorielebras|j_automatise/i);
});

test("canary remains delegated to its exact V2 persistence and V1 ledger", () => {
  assert.match(migration, /public\.persist_follow_60s_post_follow_v2\(/);
  assert.match(migration, /public\.ack_follow_60s_completed_cycle_v1\(/);
  assert.match(migration, /v_kind='canary'/);
});

test("new RPCs are service-role only and rollback is data preserving", () => {
  assert.match(migration, /set search_path=''/);
  assert.match(migration, /from public,anon,authenticated/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(rollback, /delete from|truncate|drop table|drop column/i);
  assert.match(rollback, /Functions and binding_kind stay readable/);
});
