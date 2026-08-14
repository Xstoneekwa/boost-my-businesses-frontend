import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260814103834_follow_warmup_event_type_compat_v1.sql", import.meta.url),
  "utf8",
);

test("warmup migration accepts both canonical persisted Follow event names", () => {
  assert.match(migration, /follow_verified/);
  assert.match(migration, /follow_verified_persisted_v1/);
  assert.match(migration, /interaction_status = 'success'/);
  assert.match(migration, /run_id is not null/);
});

test("warmup migration preserves the live view and fails closed on predicate drift", () => {
  assert.match(migration, /pg_get_viewdef\('public\.account_package_summary'/);
  assert.match(migration, /expected 1 legacy predicate/);
  assert.match(migration, /create or replace view public\.account_package_summary/);
  assert.doesNotMatch(migration, /username\s*=|account_id\s*=\s*'[0-9a-f-]{36}'/i);
});

test("warmup activity index covers both event names and only successful run-bound Follows", () => {
  assert.match(migration, /event_type in \('follow_verified', 'follow_verified_persisted_v1'\)/);
  assert.match(migration, /interaction_type = 'follow'/);
  assert.match(migration, /interaction_status = 'success'/);
  assert.match(migration, /run_id is not null/);
});
