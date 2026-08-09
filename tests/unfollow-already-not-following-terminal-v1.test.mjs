import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260809143000_unfollow_already_not_following_terminal_v1.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("already-not-following is terminal and service-role only", () => {
  assert.match(sql, /already_not_following_confirmed/);
  assert.match(sql, /next_retry_at is null[\s\S]*terminal_at is not null/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /service_role_required/);
  assert.match(sql, /revoke all on function[\s\S]*public, anon, authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
});

test("RPC requires positive relationship state and exact run ownership", () => {
  assert.match(sql, /'follow', 'follow_back', 'requested'/);
  assert.match(sql, /r\.id = p_source_run_id and r\.account_id = p_account_id/);
  assert.match(sql, /terminal_preserved/);
});
