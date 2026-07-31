import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260731222500_follow_60s_post_follow_composite_v2.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../supabase/rollback/20260731222500_follow_60s_post_follow_composite_v2.down.sql", import.meta.url),
  "utf8",
);

test("Post-Follow V2 is transactional, exact-bound and service-role only", () => {
  assert.match(migration, /bind_follow_60s_canary_runtime_v2/);
  assert.match(migration, /persist_follow_60s_post_follow_v2/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /follow_60s_canonical_follow_missing/);
  assert.match(migration, /v_control\.run_id is distinct from p_run_id/);
  assert.match(migration, /v_control\.request_id is distinct from p_request_id/);
  assert.match(migration, /metadata_safe->>'attempt_id'/);
  assert.match(migration, /metadata_safe->>'business_session_id'/);
  assert.match(migration, /p_cycle_complete is distinct from \('return_ct_exact' = any\(v_seen\)\)/);
  assert.match(migration, /u\.payload->>'action_id' = p_action_id/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /on conflict \(account_id, run_id, stage_idempotency_key\)/);
  assert.match(migration, /if v_event_id is null then[\s\S]*continue/);
  assert.match(migration, /total_like = coalesce\(r\.total_like, 0\) \+ v_like_increment/);
  assert.match(migration, /'current_projection',v_projection/);
  assert.match(migration, /'rejected','\[\]'::jsonb/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/);
});

test("all four physical stages and bounded waiting-operator replay are explicit", () => {
  for (const stage of [
    "mute_posts_verified",
    "mute_stories_verified",
    "like_verified",
    "return_ct_exact",
  ]) {
    assert.match(migration, new RegExp(stage));
  }
  assert.match(migration, /waiting_operator_evaluation/);
  assert.match(migration, /interval '6 hours'/);
  assert.match(migration, /jsonb_array_length\(p_stages\) > 4/);
});

test("rollback removes only the two additive V2 functions", () => {
  assert.match(rollback, /drop function if exists public\.persist_follow_60s_post_follow_v2/);
  assert.match(rollback, /drop function if exists public\.bind_follow_60s_canary_runtime_v2/);
  assert.doesNotMatch(rollback, /drop table|drop column/i);
});
