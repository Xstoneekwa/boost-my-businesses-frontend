import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("./20260727163508_client_account_ownership_requires_active_link.sql", import.meta.url),
  "utf8",
);

test("client ownership requires an active tenant-account link", () => {
  assert.match(sql, /cia\.account_id\s*=\s*p_account_id/i);
  assert.match(sql, /cia\.active\s*=\s*true/i);
  assert.match(sql, /cu\.status\s*=\s*'active'/i);
  assert.match(sql, /c\.status\s*=\s*'active'/i);
  assert.match(sql, /join public\.ig_accounts a/i);
  assert.match(sql, /a\.archived_at\s+is\s+null/i);
  assert.match(sql, /a\.trashed_at\s+is\s+null/i);
  assert.match(sql, /a\.admin_lifecycle_status[\s\S]*rolled_back_test_onboarding/i);
});

test("client ownership RPC remains service-role only", () => {
  assert.match(sql, /revoke execute[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute[\s\S]*to service_role/i);
});
