import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/20260727094636_target_followers_resume_v2_lease_privacy.sql", import.meta.url),
  "utf8",
);

test("purges and drops the plaintext target username", () => {
  assert.match(sql, /drop column if exists target_username_normalized/i);
  assert.doesNotMatch(sql, /add column[^;]*target_username_normalized/i);
  assert.match(sql, /shadow_visible_anchor_hashes = '\[\]'::jsonb/i);
});

test("uses bounded renewable leases with same-run reclaim and release", () => {
  assert.match(sql, /p_lease_seconds integer default 3600/i);
  assert.match(sql, /p_lease_seconds not between 300 and 7200/i);
  assert.match(sql, /lease_reclaimed_before_commit/i);
  assert.match(sql, /release_target_followers_resume_checkpoint_v3/i);
  assert.match(sql, /lease_owner_run_id <> p_run_id/i);
});

test("enforces monotonic depth and service-role-only RPC access", () => {
  assert.match(sql, /p_last_safe_depth < v_previous_depth/i);
  assert.match(sql, /p_last_safe_depth > v_previous_depth \+ 1/i);
  assert.match(sql, /revoke all on function public\.commit_target_followers_resume_checkpoint_v3[^;]+from public,anon,authenticated/is);
  assert.match(sql, /grant execute on function public\.commit_target_followers_resume_checkpoint_v3[^;]+to service_role/is);
  assert.match(sql, /alter table public\.ig_target_followers_resume_checkpoints enable row level security/i);
});

test("accepts only keyed v3 anchors and fingerprints", () => {
  assert.match(sql, /a3:\[0-9a-f\]\{32\}/i);
  assert.match(sql, /v3:\[0-9a-f\]\{32\}/i);
  assert.doesNotMatch(sql, /p_target_username_normalized/i);
});
