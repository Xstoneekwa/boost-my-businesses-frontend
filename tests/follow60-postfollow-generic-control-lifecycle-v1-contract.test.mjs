import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260801224629_follow60_postfollow_generic_control_lifecycle_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../supabase/rollback/20260801224629_follow60_postfollow_generic_control_lifecycle_v1.down.sql", import.meta.url),
  "utf8",
);

test("Post-Follow persistence is generic, bound, running-capable and service-role only", () => {
  assert.doesNotMatch(migration, /b024e94e-395d-4f02-9787-81ddc679b014/i);
  assert.doesNotMatch(migration, /ba73eda4-d22a-4b93-9683-2af7b8aab764/i);
  assert.match(migration, /v_control\.status not in \('running','waiting_operator_evaluation'\)/);
  assert.match(migration, /runtime_binding_consumed/);
  assert.match(migration, /FOLLOW_60S_RUNTIME_BINDING_V3/);
  assert.match(migration, /baseline_release_sha/);
  assert.match(migration, /active_control_count/);
  assert.match(migration, /follow_60s_canonical_follow_missing/);
  assert.match(migration, /on conflict\(account_id,run_id,stage_idempotency_key\)/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /from public,anon,authenticated/);
});

test("getter projects explicit binding_valid and terminalizer cannot leave a terminal run running", () => {
  assert.match(migration, /'binding_valid',v_binding_valid/);
  assert.match(migration, /v_active_count = 1/);
  assert.match(migration, /control_terminalization_invalid_transition/);
  assert.match(migration, /'waiting_operator_evaluation','completed','canceled'/);
  assert.match(migration, /v_row\.run_id is distinct from p_run_id/);
  assert.match(migration, /idempotent_replay/);
});

test("rollback restores exact predecessor names and does not mutate business rows", () => {
  for (const name of [
    "get_follow_60s_canary_control_v1",
    "persist_follow_60s_post_follow_v2",
    "terminalize_follow_60s_canary_control_v1",
  ]) {
    assert.match(rollback, new RegExp(`rename to ${name}`));
  }
  assert.doesNotMatch(rollback, /delete from|truncate|update public\./i);
});
