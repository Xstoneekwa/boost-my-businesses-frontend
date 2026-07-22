import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260722100000_target_followers_progressive_resume_v2.sql",
  import.meta.url,
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("creates one account-target-surface checkpoint and append-only audit", () => {
  assert.match(sql, /unique \(account_id, target_id, surface\)/i);
  assert.match(sql, /ig_target_followers_resume_checkpoint_events/i);
  assert.match(sql, /target_id uuid not null references public\.ig_targets\(id\)/i);
});

test("defines all five atomic RPCs", () => {
  for (const name of [
    "get_target_followers_resume_checkpoint",
    "claim_target_followers_resume_checkpoint",
    "commit_target_followers_resume_checkpoint",
    "invalidate_target_followers_resume_checkpoint",
    "reset_target_followers_resume_checkpoint",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  }
  assert.match(sql, /for update/gi);
  assert.match(sql, /optimistic_version_conflict/);
  assert.match(sql, /lease_expired/);
});

test("is RLS enabled and server-only", () => {
  assert.match(sql, /alter table public\.ig_target_followers_resume_checkpoints enable row level security/i);
  assert.match(sql, /alter table public\.ig_target_followers_resume_checkpoint_events enable row level security/i);
  assert.match(sql, /revoke all on table public\.ig_target_followers_resume_checkpoints from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update on table public\.ig_target_followers_resume_checkpoints to service_role/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /revoke execute on function public\.claim_target_followers_resume_checkpoint[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_target_followers_resume_checkpoint[\s\S]+to service_role/i);
});

test("bounds depth and hashed anchors", () => {
  assert.match(sql, /last_safe_depth between 0 and 80/i);
  assert.match(sql, /jsonb_array_length\(last_visible_anchor_hashes\) <= 12/i);
  assert.match(sql, /\^a2:\[0-9a-f\]\{24\}\$/i);
  assert.match(sql, /unproven_depth_jump_rejected/i);
  assert.match(sql, /depth_regression_rejected/i);
});

test("keeps shadow and enforce progress physically separate", () => {
  assert.match(sql, /shadow_last_safe_depth integer not null default 0/i);
  assert.match(sql, /case when p_mode = 'enforce'/i);
  assert.match(sql, /case when p_mode = 'shadow'/i);
});
