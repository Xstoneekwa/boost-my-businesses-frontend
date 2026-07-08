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
  assert.equal(status.recent_decisions[0].reason_code, "manual_only_requires_manual_trigger");
  assert.equal(status.recent_decisions[0].reason_kind, "business");
  assert.equal(status.recent_decisions[0].event, "account_decision");
  assert.equal(status.daily_engine, null);
});

test("global settings events are typed scheduler_config, never account decisions", async () => {
  const supabase = mockSupabase({
    auto_restart_settings: [{ auto_restart_enabled: false, check_every_minutes: 20, updated_at: "2026-07-06T14:25:27Z" }],
    auto_restart_tick_locks: [],
    auto_restart_decisions: [
      {
        account_id: null,
        action: "auto_restart_settings_updated",
        decision: "disabled",
        reason: "settings_patch",
        created_at: "2026-07-06T14:25:27Z",
        metadata_safe: { auto_restart_enabled: false, check_every_minutes: 20 },
      },
      {
        account_id: null,
        action: "auto_restart_settings_updated",
        decision: "production",
        reason: "settings_patch",
        created_at: "2026-07-06T14:21:22Z",
        metadata_safe: { auto_restart_enabled: true, check_every_minutes: 20 },
      },
    ],
  });

  const status = await buildSchedulerStatus(supabase, { engineHealth: null });
  assert.equal(status.recent_decisions.length, 2);
  const [off, on] = status.recent_decisions;
  assert.equal(off.event, "scheduler_config");
  assert.equal(off.config_enabled, false);
  assert.equal(off.reason_kind, "config");
  assert.equal(off.reason_code, "settings_patch");
  assert.equal(on.event, "scheduler_config");
  assert.equal(on.config_enabled, true);
  // Config events never count as examined accounts.
  assert.equal(status.examined_count, 0);
});

test("legacy literal unknown is projected as reason_unavailable, never invented", async () => {
  const supabase = mockSupabase({
    auto_restart_settings: [{ auto_restart_enabled: false, check_every_minutes: 20, updated_at: "2026-07-06T14:25:27Z" }],
    auto_restart_tick_locks: [],
    auto_restart_decisions: [
      {
        account_id: "acc-legacy",
        action: "auto_restart_candidate_evaluated",
        decision: "blocked",
        reason: "unknown",
        created_at: "2026-07-06T14:21:29Z",
        metadata_safe: { username: "i_m_your_traker" },
      },
    ],
    ig_accounts: [{ id: "acc-legacy", username: "i_m_your_traker" }],
  });

  const status = await buildSchedulerStatus(supabase, { engineHealth: null });
  assert.equal(status.recent_decisions[0].reason_code, "reason_unavailable");
  assert.equal(status.recent_decisions[0].reason_kind, "unavailable");
  assert.equal(status.recent_decisions[0].reason, "unknown");
});

test("CP2: upcoming windows derive the daily recurrence over 48h from the open assignments", async () => {
  const supabase = mockSupabase({
    auto_restart_settings: [{ auto_restart_enabled: false, check_every_minutes: 20, updated_at: "2026-07-06T14:25:27Z" }],
    auto_restart_tick_locks: [],
    auto_restart_decisions: [],
    account_assignments: [
      {
        id: "assign-fresh",
        account_id: "acc-fresh",
        device_id: "dev-1",
        // Fresh window: July 6th 06:00–12:00 local (04:00–10:00 UTC), open now.
        starts_at: "2026-07-06T04:00:00.000Z",
        ends_at: "2026-07-06T10:00:00.000Z",
        status: "reserved",
        schedule_mode: "scheduled",
        assignment_type: "full_cycle",
      },
      {
        id: "assign-expired",
        account_id: "acc-expired",
        device_id: "dev-1",
        // Expired window (July 3rd): projection must show the derived next
        // occurrences, flag the stored row as expired, never stay silent.
        starts_at: "2026-07-03T20:00:00.000Z",
        ends_at: "2026-07-04T02:00:00.000Z",
        status: "reserved",
        schedule_mode: "scheduled",
        assignment_type: "full_cycle",
      },
      {
        id: "assign-manual",
        account_id: "acc-manual",
        device_id: "dev-1",
        starts_at: "2026-07-03T04:00:00.000Z",
        ends_at: "2026-07-03T10:00:00.000Z",
        status: "reserved",
        schedule_mode: "manual_only",
        assignment_type: "full_cycle",
      },
    ],
    phone_devices: [{ id: "dev-1", name: "Samsung A16-01", timezone: "Africa/Johannesburg" }],
    ig_accounts: [
      { id: "acc-fresh", username: "client_fresh" },
      { id: "acc-expired", username: "client_expired" },
      { id: "acc-manual", username: "client_manual" },
    ],
  });

  const status = await buildSchedulerStatus(supabase, {
    engineHealth: null,
    now: new Date("2026-07-06T05:00:00.000Z"), // 07:00 local
  });

  assert.equal(status.windows_horizon_hours, 48);
  // manual_only is a hard exclusion: never projected.
  assert.equal(status.upcoming_windows.some((w) => w.account_id === "acc-manual"), false);

  const fresh = status.upcoming_windows.filter((w) => w.account_id === "acc-fresh");
  assert.equal(fresh.length, 3); // today (open) + 2 next days inside 48h
  assert.equal(fresh[0].is_open, true);
  assert.equal(fresh[0].materialized, true);
  assert.equal(fresh[0].stored_window_expired, false);
  assert.equal(fresh[0].local_slot, "06:00–12:00");
  assert.equal(fresh[0].username, "client_fresh");
  assert.equal(fresh[0].device_name, "Samsung A16-01");
  assert.equal(fresh[1].starts_at, "2026-07-07T04:00:00.000Z");

  const expired = status.upcoming_windows.filter((w) => w.account_id === "acc-expired");
  assert.ok(expired.length >= 2);
  // 22:00–04:00 local slot: next occurrence tonight, clearly flagged as
  // derived from an expired stored window (not yet materialized).
  assert.equal(expired[0].starts_at, "2026-07-06T20:00:00.000Z");
  assert.equal(expired[0].stored_window_expired, true);
  assert.equal(expired[0].materialized, false);
  assert.equal(expired[0].local_slot, "22:00–04:00");
  // Windows are sorted by start time.
  const starts = status.upcoming_windows.map((w) => w.starts_at);
  assert.deepEqual(starts, [...starts].sort());
});

test("daily engine projection follows env plus the canonical toggle", async () => {
  const fixtures = {
    auto_restart_settings: [{ auto_restart_enabled: false, check_every_minutes: 20, updated_at: "2026-07-06T14:25:27Z" }],
    auto_restart_tick_locks: [],
    auto_restart_decisions: [],
  };

  const disabled = await buildSchedulerStatus(mockSupabase(fixtures), {
    engineHealth: null,
    dailyEngineEnv: { technicalEnabled: false, dryRun: true },
  });
  assert.equal(disabled.daily_engine?.state, "technical_disabled");

  const dryRun = await buildSchedulerStatus(mockSupabase(fixtures), {
    engineHealth: null,
    dailyEngineEnv: { technicalEnabled: true, dryRun: true },
  });
  assert.equal(dryRun.daily_engine?.state, "dry_run");

  const schedulerOff = await buildSchedulerStatus(mockSupabase(fixtures), {
    engineHealth: null,
    dailyEngineEnv: { technicalEnabled: true, dryRun: false },
  });
  assert.equal(schedulerOff.daily_engine?.state, "scheduler_disabled");

  const active = await buildSchedulerStatus(mockSupabase({
    ...fixtures,
    auto_restart_settings: [{ auto_restart_enabled: true, check_every_minutes: 20, updated_at: "2026-07-06T14:25:27Z" }],
  }), {
    engineHealth: null,
    dailyEngineEnv: { technicalEnabled: true, dryRun: false },
  });
  assert.equal(active.daily_engine?.state, "active");
});

test("buildSchedulerStatus projects daily runtime gate when provided", async () => {
  const supabase = mockSupabase({
    auto_restart_settings: [{ auto_restart_enabled: true, check_every_minutes: 20, updated_at: "2026-07-08T12:00:00Z" }],
    auto_restart_tick_locks: [],
    auto_restart_decisions: [],
    account_assignments: [],
  });
  const status = await buildSchedulerStatus(supabase, {
    engineHealth: { healthy: true, dispatcherWorkerId: "run-dispatcher:host", lastSeenAt: "2026-07-08T19:00:00Z", reason: null },
    dailyEngineEnv: { technicalEnabled: true, dryRun: false },
    dailyRuntimeGate: {
      scheduler_connected: false,
      status: "stale",
      heartbeat_age_seconds: 240,
      reason: "BotApp scheduler runtime heartbeat is stale.",
    },
  });
  assert.equal(status.daily_runtime_gate?.status, "stale");
  assert.equal(status.daily_runtime_gate?.scheduler_connected, false);
  assert.equal(status.daily_runtime_gate?.heartbeat_age_seconds, 240);
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
