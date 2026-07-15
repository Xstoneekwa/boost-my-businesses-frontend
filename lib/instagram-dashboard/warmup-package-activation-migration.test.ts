import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../supabase/migrations/20260715231159_initialize_warmup_on_package_activation.sql", import.meta.url),
  "utf8",
);

test("package activation initializes the canonical Follow warmup defaults", () => {
  assert.match(source, /after insert or update of status, ends_at, starts_at/i);
  assert.match(source, /new\.status = 'active' and new\.ends_at is null/i);
  assert.match(source, /coalesce\(new\.starts_at, new\.created_at, now\(\)\)/i);
  assert.match(source, /'follow_default_v1'[\s\S]*?10,[\s\S]*?20,[\s\S]*?40,[\s\S]*?null,[\s\S]*?'active'/i);
});

test("a later package change cannot restart an established warmup", () => {
  assert.match(source, /on conflict \(account_id\) do update/i);
  assert.match(source, /where account_warmup_settings\.package_started_at is null/i);
  assert.doesNotMatch(source, /update\s+public\.account_warmup_settings\s+set\s+package_started_at/i);
});

test("the migration is prospective and contains no account backfill", () => {
  assert.doesNotMatch(source, /insert into public\.account_warmup_settings[\s\S]*select/i);
  assert.doesNotMatch(source, /83de9cc9|0d299d1e/i);
});
