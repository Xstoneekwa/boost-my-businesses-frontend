import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260911123000_instagram_identity_restriction_resume_contract_v1.sql", import.meta.url),
  "utf8",
);
const tick = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");
const runControl = readFileSync(new URL("./run-control.ts", import.meta.url), "utf8");

test("direct Identity Guard restrictions create the physical-preflight hold", () => {
  assert.match(migration, /sync_identity_guard_restriction_hold_v1/);
  assert.match(migration, /instagram_account_restriction_messages_disabled/);
  assert.match(migration, /insert into public\.instagram_account_restriction_holds/);
  assert.match(migration, /'active'/);
  assert.match(migration, /admin_lifecycle_status = 'paused'/);
});

test("resolution moves the same hold to verification_required", () => {
  assert.match(migration, /new\.status = 'resolved'[\s\S]*'verification_required'/);
  assert.match(migration, /incident_resolved_but_physical_preflight_pending/);
});

test("only an armed unresolved one-shot contract is backfilled", () => {
  const backfill = migration.slice(migration.indexOf("with eligible as"));
  assert.match(backfill, /resume_auth\.status = 'armed'/);
  assert.match(backfill, /coalesce\(resume_auth\.expires_at, resume_auth\.scheduled_window_end\) > now\(\)/);
  assert.match(backfill, /coalesce\(resume_auth\.test, false\) is false/);
  assert.match(backfill, /incident\.status = 'resolved'/);
  assert.match(backfill, /not exists \([\s\S]*blocking_hold/);
});

test("tick and run-start retain the same verification_required authority", () => {
  assert.match(tick, /instagram_account_restriction_holds[\s\S]*verification_required/);
  assert.match(tick, /consume_resume_authorization_and_create_request_v4/);
  assert.match(runControl, /instagram_account_restriction_holds[\s\S]*verification_required/);
  assert.match(runControl, /restriction_preflight_not_authorized/);
});

test("messages-disabled duration comes from parsed Instagram evidence", () => {
  const projection = migration.slice(migration.indexOf("create or replace function public.canonical_active_blocking_incidents_v1"));
  assert.match(projection, /restriction_end_date/);
  assert.match(projection, /instagram_account_restriction_messages_disabled/);
  assert.doesNotMatch(
    projection.slice(
      projection.indexOf("instagram_account_restriction_messages_disabled"),
      projection.indexOf("instagram_action_rate_limit"),
    ),
    /48 hours/,
  );
});
