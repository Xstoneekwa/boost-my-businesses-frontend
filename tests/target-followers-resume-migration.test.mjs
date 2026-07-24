import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260724215200_target_followers_progressive_resume_v2.sql",
  import.meta.url,
);
const sql = fs.readFileSync(migrationPath, "utf8");
const schemaPrefix = sql.split("create or replace function", 1)[0];

test("creates one account-target-surface checkpoint and append-only events", () => {
  assert.match(sql, /unique \(account_id, target_id, surface\)/i);
  assert.match(sql, /ig_target_followers_resume_checkpoint_events/i);
  assert.match(sql, /target_id uuid not null references public\.ig_targets\(id\)/i);
  assert.doesNotMatch(schemaPrefix, /insert into/i);
});

test("defines the five atomic RPCs with CAS and bounded leases", () => {
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
  assert.match(sql, /p_lease_seconds not between 30 and 900/);
  assert.match(sql, /unproven_depth_jump_rejected/);
});

test("is RLS-on, security-definer hardened, and RPC-only for service role", () => {
  assert.match(sql, /alter table public\.ig_target_followers_resume_checkpoints enable row level security/i);
  assert.match(sql, /alter table public\.ig_target_followers_resume_checkpoint_events enable row level security/i);
  assert.match(sql, /revoke all on table public\.ig_target_followers_resume_checkpoints from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant select on table public\.ig_target_followers_resume_checkpoints to service_role/i);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]+ig_target_followers_resume/i);
  assert.doesNotMatch(sql, /create policy/i);
  assert.equal((sql.match(/security definer/gi) ?? []).length, 5);
  assert.equal((sql.match(/set search_path = ''/gi) ?? []).length, 5);
  assert.match(sql, /revoke all on function public\.claim_target_followers_resume_checkpoint[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_target_followers_resume_checkpoint[\s\S]+to service_role/i);
});

test("bounds depth, anchors, event metadata, and timestamps", () => {
  assert.match(sql, /last_safe_depth between 0 and 80/i);
  assert.match(sql, /jsonb_array_length\(last_visible_anchor_hashes\) <= 12/i);
  assert.match(sql, /\^a2:\[0-9a-f\]\{24\}\$/i);
  assert.match(sql, /pg_column_size\(metadata\) <= 4096/i);
  assert.match(sql, /updated_at >= created_at/i);
});

test("keeps shadow and enforce state physically separate", () => {
  assert.match(sql, /shadow_last_safe_depth integer not null default 0/i);
  assert.match(sql, /case when p_mode = 'enforce'/i);
  assert.match(sql, /case when p_mode = 'shadow'/i);
  assert.match(sql, /target_account_mismatch/i);
});
