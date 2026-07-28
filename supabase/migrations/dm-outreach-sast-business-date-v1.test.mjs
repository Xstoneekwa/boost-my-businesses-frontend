import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260728001427_dm_outreach_sast_business_date_v1.sql", import.meta.url),
  "utf8",
);

test("DM and Outreach derive counter dates from Johannesburg outcome timestamps", () => {
  assert.match(migration, /timezone\('Africa\/Johannesburg', now\(\)\)/);
  assert.match(migration, /case when v_job\.status = 'sent' then v_job\.sent_at else v_job\.finished_at end/);
  assert.doesNotMatch(migration, /timezone\('utc', now\(\)\)/i);
});

test("backfill is evidence-based and preserves the successful-send total", () => {
  assert.match(migration, /where sent_at is not null/);
  assert.match(migration, /status in \('skipped', 'failed'\)/);
  assert.match(migration, /DM counter SAST backfill mismatch/);
});

test("completion is idempotent for a repeated terminal outcome", () => {
  assert.match(migration, /select \*[\s\S]*for update/);
  assert.match(migration, /v_previous_job\.status is distinct from v_job\.status/);
  assert.match(migration, /v_previous_job\.finished_at is null/);
});

test("security definer RPCs remain service-role only", () => {
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
});
