import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSchedulerStatus,
  projectSchedulerBackendMode,
  projectSchedulerEngineStatus,
  summarizeDecisions,
  summarizeTickLocks,
} from "./scheduler-status.ts";

type TableFixtures = Record<string, unknown[]>;

function mockSupabase(fixtures: TableFixtures) {
  const calls: Array<{ table: string }> = [];
  function builder(table: string) {
    const rows = fixtures[table] ?? [];
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const method of ["select", "eq", "in", "gte", "order"]) chain[method] = self;
    chain.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    chain.limit = async () => ({ data: rows, error: null });
    return chain;
  }
  return {
    calls,
    from(table: string) {
      calls.push({ table });
      return builder(table);
    },
  };
}

test("engine status distinguishes running, degraded and unknown", () => {
  assert.equal(
    projectSchedulerEngineStatus({ healthy: true, dispatcherWorkerId: "run-dispatcher:mac", lastSeenAt: "2026-07-06T10:00:00Z" }),
    "running",
  );
  assert.equal(
    projectSchedulerEngineStatus({ healthy: false, dispatcherWorkerId: "run-dispatcher:mac", lastSeenAt: "2026-07-06T08:00:00Z" }),
    "degraded",
  );
  assert.equal(projectSchedulerEngineStatus({ healthy: false, dispatcherWorkerId: null, lastSeenAt: null }), "unknown");
  assert.equal(
    projectSchedulerEngineStatus({
      healthy: false,
      dispatcherWorkerId: "run-dispatcher:mac",
      lastSeenAt: null,
      reason: "dispatcher_health_read_failed",
    }),
    "unknown",
  );
  assert.equal(projectSchedulerEngineStatus(null), "unknown");
});

test("backend mode reflects the canonical auto_restart_enabled flag only", () => {
  assert.equal(projectSchedulerBackendMode({ auto_restart_enabled: true }), "enabled");
  assert.equal(projectSchedulerBackendMode({ auto_restart_enabled: false }), "disabled_by_config");
  assert.equal(projectSchedulerBackendMode(null), "disabled_by_config");
});

test("tick lock summary keeps only real timestamps and errors", () => {
  const summary = summarizeTickLocks([
    { tick_started_at: "2026-07-06T10:00:00Z", tick_completed_at: "2026-07-06T10:00:05Z", status: "completed" },
    { tick_started_at: "2026-07-06T09:40:00Z", tick_completed_at: "2026-07-06T09:40:02Z", status: "failed" },
    { tick_started_at: "2026-07-06T09:20:00Z", tick_completed_at: null, status: "started" },
  ]);
  assert.equal(summary.lastTickAt, "2026-07-06T10:00:00Z");
  assert.equal(summary.lastSuccessAt, "2026-07-06T10:00:05Z");
  assert.deepEqual(summary.lastError, { at: "2026-07-06T09:40:02Z", reason: "tick_failed" });
});

test("tick lock summary exposes the persisted redacted failure reason", () => {
  const summary = summarizeTickLocks([
    {
      tick_started_at: "2026-07-06T09:40:00Z",
      tick_completed_at: "2026-07-06T09:40:02Z",
      status: "failed",
      metadata_safe: { tick_bucket: "2026-07-06T09:40:00Z", failure_reason: "db timeout" },
    },
  ]);
  assert.deepEqual(summary.lastError, { at: "2026-07-06T09:40:02Z", reason: "db timeout" });
});

test("tick lock summary reports no error when none is persisted", () => {
  const summary = summarizeTickLocks([
    { tick_started_at: "2026-07-06T10:00:00Z", tick_completed_at: "2026-07-06T10:00:05Z", status: "completed" },
  ]);
  assert.equal(summary.lastError, null);
});

test("decision summary counts distinct examined accounts and outcomes", () => {
  const summary = summarizeDecisions([
    { account_id: "a", decision: "enqueued" },
    { account_id: "a", decision: "blocked" },
    { account_id: "b", decision: "blocked" },
    { account_id: "", decision: "blocked" },
  ]);
  assert.equal(summary.examinedCount, 2);
  assert.equal(summary.enqueuedCount, 1);
  assert.equal(summary.blockedCount, 2);
});

test("buildSchedulerStatus projects canonical facts without inventing values", async () => {
  const supabase = mockSupabase({
    auto_restart_settings: [{ auto_restart_enabled: false, check_every_minutes: 20, updated_at: "2026-07-01T00:00:00Z" }],
    auto_restart_tick_locks: [
      { tick_started_at: "2026-07-05T10:00:00Z", tick_completed_at: "2026-07-05T10:00:04Z", status: "completed" },
    ],
    auto_restart_decisions: [
      {
        account_id: "acc-1",
        action: "auto_restart_candidate_evaluated",
        decision: "blocked",
        reason: "manual_only_requires_manual_trigger",
        created_at: "2026-07-05T10:00:03Z",
        metadata_safe: { username: "fallback_name" },
      },
    ],
    ig_accounts: [{ id: "acc-1", username: "client_account" }],
  });

  const status = await buildSchedulerStatus(supabase, {
    engineHealth: { healthy: true, dispatcherWorkerId: "run-dispatcher:mac", lastSeenAt: "2026-07-06T10:00:00Z" },
    now: new Date("2026-07-06T10:00:00Z"),
  });

  assert.equal(status.read_only, true);
  assert.equal(status.engine_status, "running");
  assert.equal(status.backend_mode, "disabled_by_config");
  assert.equal(status.tick_interval_seconds, 1200);
  assert.equal(status.last_tick_at, "2026-07-05T10:00:00Z");
  assert.equal(status.last_success_at, "2026-07-05T10:00:04Z");
  assert.equal(status.last_error, null);
  assert.equal(status.examined_count, 1);
  assert.equal(status.enqueued_count, 0);
  assert.equal(status.blocked_count, 1);
  assert.equal(status.recent_decisions.length, 1);
  assert.equal(status.recent_decisions[0].username, "client_account");
  assert.equal(status.recent_decisions[0].reason, "manual_only_requires_manual_trigger");
});

test("buildSchedulerStatus omits tick interval when settings row is absent", async () => {
  const supabase = mockSupabase({
    auto_restart_settings: [],
    auto_restart_tick_locks: [],
    auto_restart_decisions: [],
  });
  const status = await buildSchedulerStatus(supabase, { engineHealth: null });
  assert.equal(status.tick_interval_seconds, null);
  assert.equal(status.engine_status, "unknown");
  assert.equal(status.last_tick_at, null);
  assert.equal(status.recent_decisions.length, 0);
});

test("scheduler status route stays read-only and relay/admin protected", () => {
  const source = readFileSync(
    new URL("../../app/api/instagram-dashboard/auto-restart/scheduler-status/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requireRelayOrAdmin/);
  assert.match(source, /export async function GET/);
  assert.doesNotMatch(source, /export async function (POST|PATCH|PUT|DELETE)/);
  assert.doesNotMatch(source, /create_account_run_request/);
  assert.doesNotMatch(source, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
});
