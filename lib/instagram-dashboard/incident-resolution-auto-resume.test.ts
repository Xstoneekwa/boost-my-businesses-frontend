import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260727001500_incident_resolution_auto_resume_v1.sql", import.meta.url),
  "utf8",
);

test("resolving a linked operator action resolves the canonical incident", () => {
  assert.match(migration, /dashboard_action_resolution_sync_incident_v1/);
  assert.match(migration, /new\.action_type not in \('operator_review_required', 'review_auto_restart_hard_stop'\)/);
  assert.match(migration, /update public\.account_incidents[\s\S]*set status = 'resolved'/);
  assert.match(migration, /new\.blocking_campaign := false/);
});

test("incident resolution atomically arms one natural-tick authorization", () => {
  assert.match(migration, /account_incident_resolution_auto_resume_v1/);
  assert.match(migration, /resume_state = 'awaiting_human_resume_authorization'/);
  assert.match(migration, /insert into public\.incident_resume_authorizations/);
  assert.match(migration, /status, armed_source/);
  assert.match(migration, /'armed', 'incident_resolution'/);
  assert.match(migration, /on conflict do nothing/);
});

test("historical split-brain rows are reconciled through the same trigger", () => {
  const backfill = migration.slice(migration.indexOf("-- One-time reconciliation"));
  assert.match(backfill, /a\.status = 'resolved'/);
  assert.match(backfill, /i\.status in \('open', 'acknowledged', 'investigating'\)/);
  assert.match(backfill, /set status = 'resolved'/);
});

test("authorization storage is service-role only", () => {
  assert.match(migration, /revoke all on table public\.incident_resume_authorizations from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.incident_resume_authorizations to service_role/);
});
