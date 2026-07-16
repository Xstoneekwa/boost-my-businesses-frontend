import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260716112500_transactional_growth_settings_and_warmup_backfill.sql",
  import.meta.url,
);

test("growth settings RPCs are transactional, audited, idempotent, and service-role only", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  for (const rpc of [
    "save_account_follow_settings_v1",
    "save_account_unfollow_settings_v1",
    "backfill_account_warmup_start_v1",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}\\(`));
    assert.match(sql, new RegExp(`revoke all on function public\\.${rpc}\\([^;]+from public, anon, authenticated;`, "s"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}\\([^;]+to service_role;`, "s"));
  }

  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /idempotency_key_required/);
  assert.match(sql, /follow_warmup_settings_saved/);
  assert.match(sql, /unfollow_domain_settings_saved/);
  assert.match(sql, /follow_warmup_start_backfilled/);
});
