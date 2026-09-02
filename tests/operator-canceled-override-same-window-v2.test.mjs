import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260902204847_operator_canceled_override_same_window_retry_v2.sql"), "utf8");
const scheduler = fs.readFileSync(path.join(root, "lib/instagram-dashboard/schedule-session-cron.ts"), "utf8");

test("reconciliation requires exact request/run/account lineage", () => {
  assert.match(migration, /r\.id = p_request_id[\s\S]+r\.account_id = p_account_id[\s\S]+r\.run_id = p_run_id/);
});

test("operator cancellation requires canonical terminal request run and plan", () => {
  assert.match(migration, /v_request\.status <> 'canceled'/);
  assert.match(migration, /v_run\.status not in \('stopped', 'canceled'\)/);
  assert.match(migration, /v_plan\.terminal_reason_code <> 'operator_canceled'/);
});

test("run-created incident proof is bounded by run start and request id", () => {
  assert.match(migration, /i\.created_at >= coalesce\(v_run\.started_at/);
  assert.match(migration, /i\.metadata ->> 'request_id' = p_request_id::text/);
});

test("incident history is resolved, never deleted", () => {
  assert.match(migration, /set status = 'resolved'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.account_incidents/i);
  assert.match(migration, /detected_history_preserved', true/);
});

test("only linked dashboard actions are neutralized", () => {
  assert.match(migration, /where a\.incident_id = any\(v_incident_ids\)/);
  assert.match(migration, /blocking_campaign = false, requires_client_action = false/);
});

test("armed resume authorization cannot survive operator cancel", () => {
  assert.match(migration, /set status = 'revoked'/);
  assert.match(migration, /a\.run_id = p_run_id/);
});

test("reconciliation creates no replacement request", () => {
  const reconciliation = migration.split("create or replace function public.create_schedule_session_retry_v2")[0];
  assert.doesNotMatch(reconciliation, /create_account_run_request\s*\(/);
  assert.match(reconciliation, /'immediate_restart_created', false/);
});

test("natural retry accepts exact operator-canceled plan only", () => {
  assert.match(migration, /v_base\.status = 'canceled'[\s\S]+v_plan\.resume_state <> 'completed'/);
  assert.match(migration, /v_plan\.restart_block_reason <> 'operator_canceled'/);
});

test("same-window retry is bounded and concurrency locked", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /least\(greatest\(coalesce\(p_retry_limit, 1\), 1\), 3\)/);
  assert.match(migration, /:retry:v2:/);
});

test("scheduler calls v2 only from a natural tick path", () => {
  assert.match(scheduler, /operatorCanceled = status === "canceled"/);
  assert.match(scheduler, /supabase\.rpc\("create_schedule_session_retry_v2"/);
  assert.doesNotMatch(scheduler, /reconcile_operator_canceled_run_v1/);
});

test("independent blockers and manual stop still fail closed", () => {
  assert.match(migration, /manual_stop_requested, false/);
  assert.match(migration, /i\.status in \('open','acknowledged','investigating'\)/);
  assert.match(migration, /a\.blocking_campaign or a\.requires_client_action/);
  assert.match(migration, /h\.status in \('active', 'verification_required'\)/);
  assert.match(migration, /'independent_blockers_preserved', v_independent_blockers/);
});

test("atomic retry rechecks canonical blocking dashboard actions", () => {
  const retry = migration.split("create or replace function public.create_schedule_session_retry_v2")[1];
  assert.match(retry, /from public\.account_dashboard_actions a/);
  assert.match(retry, /coalesce\(a\.blocking_campaign, false\)/);
  assert.match(retry, /a\.status in \('pending','acknowledged','pending_verification','code_submitted'\)/);
  assert.match(retry, /a\.incident_id is null[\s\S]+linked_incident\.resolved_at is null[\s\S]+linked_incident\.archived_at is null/);
});

test("atomic retry rechecks active and verification-required restriction holds", () => {
  const retry = migration.split("create or replace function public.create_schedule_session_retry_v2")[1];
  assert.match(retry, /from public\.instagram_account_restriction_holds h/);
  assert.match(retry, /h\.status in \('active','verification_required'\)/);
});

test("service role is the only executable application role", () => {
  assert.match(migration, /service_role_required/);
  assert.match(migration, /revoke all on function public\.reconcile_operator_canceled_run_v1[\s\S]+from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.create_schedule_session_retry_v2[\s\S]+to service_role/);
});

test("retry SECURITY DEFINER resolves no caller-controlled schema", () => {
  const retry = migration.split("create or replace function public.create_schedule_session_retry_v2")[1];
  assert.match(retry, /security definer\s+set search_path = ''/);
});
