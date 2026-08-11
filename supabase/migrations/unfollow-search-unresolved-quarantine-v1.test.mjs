import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260811193000_unfollow_search_unresolved_quarantine_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../rollback/20260811193000_unfollow_search_unresolved_quarantine_v1.down.sql", import.meta.url),
  "utf8",
);

test("repeated unresolved Search uses bounded quarantine-equivalent retry floors", () => {
  assert.match(migration, /technical_attempt_count, 0\) >= 4 then interval '72 hours'/);
  assert.match(migration, /technical_attempt_count, 0\) = 3 then interval '24 hours'/);
  assert.match(migration, /technical_attempt_count, 0\) = 2 then interval '6 hours'/);
  assert.match(migration, /else interval '30 minutes'/);
  assert.match(migration, /new\.status <> 'search_surface_unhealthy'/);
  assert.match(migration, /new\.technical_attempt_count, 0\)[\s\S]+<= coalesce\(old\.technical_attempt_count, 0\)/);
  assert.doesNotMatch(migration, /username_not_found_confirmed/);
});

test("quarantine trigger is least-privilege and rollback is exact", () => {
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /revoke all on function[\s\S]+from public, anon, authenticated/);
  assert.match(rollback, /drop trigger if exists enforce_unfollow_search_unresolved_quarantine_v1/);
  assert.match(rollback, /drop function if exists public\.enforce_unfollow_search_unresolved_quarantine_v1\(\)/);
});
