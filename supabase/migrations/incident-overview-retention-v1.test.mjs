import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("./20260724180000_incident_overview_retention_v1.sql", import.meta.url), "utf8");

test("retention defaults match the approved policy", () => {
  assert.match(sql, /normal_resolved_days integer not null default 180/);
  assert.match(sql, /critical_resolved_days integer not null default 365/);
  assert.match(sql, /technical_nonblocking_days integer not null default 90/);
  assert.match(sql, /delivery_log_days integer not null default 90/);
  assert.match(sql, /cleanup_batch_size integer not null default 250/);
});

test("cleanup is bounded, locked, journaled and protects active work", () => {
  assert.match(sql, /pg_try_advisory_xact_lock/);
  assert.match(sql, /for update skip locked/gi);
  assert.match(sql, /limit v_batch/);
  assert.match(sql, /incident_cleanup_runs/);
  assert.match(sql, /pending_verification/);
  assert.match(sql, /i\.run_id is null/);
  assert.match(sql, /run_request_id/);
});

test("overview uses a stable tuple cursor and global counters", () => {
  assert.match(sql, /\(f\.last_seen_at, f\.id\) < \(p_cursor_last_seen_at, p_cursor_id\)/);
  assert.match(sql, /order by last_seen_at desc, id desc/);
  assert.match(sql, /global_counters/);
  assert.match(sql, /action_required_count/);
});

test("incident RPC grants are service-role only", () => {
  assert.match(sql, /revoke all on function public\.get_account_incidents_overview_v1[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.get_account_incidents_overview_v1[\s\S]*to service_role/);
  assert.match(sql, /revoke all on table public\.incident_cleanup_runs from public, anon, authenticated/);
});

test("daily cleanup is scheduled without touching Phone Farm scheduler functions", () => {
  assert.match(sql, /incident-retention-cleanup-daily-v1/);
  assert.match(sql, /'17 3 \* \* \*'/);
  assert.doesNotMatch(sql, /create_account_run_request|evaluate_account_schedule_gate|dispatcher|heartbeat/);
});
