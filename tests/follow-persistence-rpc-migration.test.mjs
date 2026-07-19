import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/20260719110000_persist_verified_follow_success_v1.sql", import.meta.url),
  "utf8",
);

test("verified Follow RPC is one invoker transaction with restricted ACL", () => {
  assert.match(sql, /create or replace function public\.persist_verified_follow_success_v1/);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = ''/i);
  assert.doesNotMatch(sql, /security definer/i);
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(sql, new RegExp(`from ${role};`, "i"));
  }
  assert.match(sql, /grant execute[\s\S]+to service_role;/i);
});

test("RPC validates ownership, metadata, locked settings revision and computes eligibility", () => {
  assert.match(sql, /follow_persistence_request_run_mismatch/);
  assert.match(sql, /follow_persistence_run_account_mismatch/);
  assert.match(sql, /follow_persistence_target_account_mismatch/);
  assert.match(sql, /jsonb_has_forbidden_safe_metadata_key/);
  assert.match(sql, /from public\.ig_account_unfollow_settings[\s\S]+for update/);
  assert.match(sql, /follow_persistence_settings_revision_mismatch/);
  assert.match(sql, /v_followed_at \+ make_interval\(days => v_settings\.unfollow_after_days\)/);
  assert.doesNotMatch(sql, /p_eligible_unfollow_at/);
});

test("action event gates replay, interaction and source counter exactly once", () => {
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /'idempotent_replay'/);
  assert.match(sql, /follow_persistence_action_id_conflict/);
  assert.match(sql, /follow_persistence_casefold_ambiguous/);
  assert.match(sql, /follow_persistence_active_interaction_exists/);
  assert.match(sql, /follows_sent_count = coalesce\(t\.follows_sent_count, 0\) \+ 1/);
  assert.match(sql, /'counter_applied', true/);
  assert.match(sql, /'audit_persisted', true/);
});

test("partial or unsafe inputs cannot produce a successful contract", () => {
  assert.match(sql, /follow_persistence_state_not_verified/);
  assert.match(sql, /follow_persistence_metadata_unsafe/);
  assert.match(sql, /follow_persistence_existing_action_incomplete/);
  assert.match(sql, /raise exception 'follow_persistence_target_counter_failed'/);
});
