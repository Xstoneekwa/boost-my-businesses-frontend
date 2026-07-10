import assert from "node:assert/strict";
import test from "node:test";

import {
  assignmentWindowActive,
  extractScheduleSessionCronToken,
  readScheduleSessionCronEnv,
  runScheduleSessionCron,
  scheduleSessionIdempotencyKey,
} from "./schedule-session-cron.ts";

const baseEnv = {
  INSTAGRAM_SCHEDULE_SESSION_CRON_TOKEN: "cron-token",
  INSTAGRAM_SCHEDULE_SESSION_CRON_ENABLED: "true",
  INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "true",
  INSTAGRAM_SCHEDULE_SESSION_CRON_LIMIT: "5",
};

const windowStart = "2026-06-30T04:00:00.000Z";
const windowEnd = "2026-06-30T10:00:00.000Z";
const inWindowNow = new Date("2026-06-30T06:00:00.000Z");
const beforeWindowNow = new Date("2026-06-30T03:00:00.000Z");
const afterWindowNow = new Date("2026-06-30T11:00:00.000Z");
const activeRuntimeHealth = async () => ({ schedulerConnected: true, status: "active" });

const defaultAssignment = {
  id: "assignment-1",
  account_id: "account-1",
  device_id: "device-1",
  app_instance_id: "app-1",
  starts_at: windowStart,
  ends_at: windowEnd,
  status: "reserved",
  schedule_mode: "scheduled",
  assignment_type: "full_cycle",
};

function makeQueryResult(rows: unknown[]) {
  const query = {
    select: () => query,
    in: () => query,
    eq: () => query,
    lte: () => query,
    gt: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return query;
}

function makeSupabase(overrides: {
  assignments?: Array<Record<string, unknown>>;
  devices?: Array<Record<string, unknown>>;
  heartbeats?: Array<Record<string, unknown>>;
  peers?: Array<Record<string, unknown>>;
  activeRequests?: Array<Record<string, unknown>>;
  activeRuns?: Array<Record<string, unknown>>;
  schedulerEnabled?: boolean;
  rpcError?: { message: string };
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const assignmentUpdates: Array<Record<string, unknown>> = [];
  return {
    rpcCalls,
    assignmentUpdates,
    client: {
      from(table: string) {
        if (table === "auto_restart_settings") {
          return makeQueryResult([{ auto_restart_enabled: overrides.schedulerEnabled ?? true }]);
        }
        if (table === "account_assignments") {
          const rows = overrides.assignments ?? [defaultAssignment];
          const query = makeQueryResult(rows);
          const withUpdate = (base: Record<string, unknown>) => ({
            ...base,
            update: (values: Record<string, unknown>) => {
              assignmentUpdates.push(values);
              const chain = {
                eq: () => chain,
                select: () => Promise.resolve({ data: [{ id: "assignment-1" }], error: null }),
              };
              return chain;
            },
          });
          return withUpdate({
            ...query,
            eq: (column: string, value: unknown) => {
              if (column === "schedule_mode" && value === "scheduled") {
                return withUpdate(makeQueryResult(rows.filter((row) => row.schedule_mode === "scheduled")) as unknown as Record<string, unknown>);
              }
              return withUpdate(query as unknown as Record<string, unknown>);
            },
          });
        }
        if (table === "phone_devices") {
          return makeQueryResult(overrides.devices ?? [{
            id: "device-1",
            device_kind: "physical_phone",
            status: "available",
            timezone: "Africa/Johannesburg",
            name: "Samsung A16-01",
          }]);
        }
        if (table === "device_heartbeats") {
          return makeQueryResult(overrides.heartbeats ?? [{
            device_id: "device-1",
            status: "online",
            last_seen_at: inWindowNow.toISOString(),
          }]);
        }
        if (table === "account_run_requests") {
          return makeQueryResult(overrides.activeRequests ?? []);
        }
        if (table === "ig_runs") {
          return makeQueryResult(overrides.activeRuns ?? []);
        }
        if (table === "auto_restart_device_locks") {
          return makeQueryResult([]);
        }
        if (table === "phone_app_instances") {
          return makeQueryResult([{ id: "app-1", package_name: "com.instagram.android" }]);
        }
        if (table === "ig_accounts") {
          return makeQueryResult([{ id: "account-1", username: "i_m_your_traker" }]);
        }
        if (table === "account_dashboard_actions") {
          return makeQueryResult([]);
        }
        return makeQueryResult([]);
      },
      rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (overrides.rpcError && name === "create_account_run_request") {
          return Promise.resolve({ data: null, error: overrides.rpcError });
        }
        if (name === "get_valid_scheduled_session_preflight") {
          return Promise.resolve({
            data: { id: "preflight-1", request_id: "preflight-request-1", status: "preflight_ready" },
            error: null,
          });
        }
        if (name === "handoff_preflight_device_lock_to_request") {
          return Promise.resolve({ data: { ok: true, transferred: true }, error: null });
        }
        if (name === "auto_restart_acquire_device_lock") {
          return Promise.resolve({ data: { ok: true, acquired: true, lease_id: "lease-1" }, error: null });
        }
        if (name === "auto_restart_bind_device_lock_to_request") {
          return Promise.resolve({ data: { ok: true, bound: true }, error: null });
        }
        if (name === "cancel_account_run_request") {
          return Promise.resolve({ data: { ok: true }, error: null });
        }
        return Promise.resolve({ data: { id: "request-1", status: "queued" }, error: null });
      },
    },
  };
}

test("assignmentWindowActive matches inclusive start and exclusive end", () => {
  assert.equal(assignmentWindowActive(windowStart, windowEnd, inWindowNow), true);
  assert.equal(assignmentWindowActive(windowStart, windowEnd, new Date(windowStart)), true);
  assert.equal(assignmentWindowActive(windowStart, windowEnd, new Date(windowEnd)), false);
  assert.equal(assignmentWindowActive(windowStart, windowEnd, beforeWindowNow), false);
  assert.equal(assignmentWindowActive(windowStart, windowEnd, afterWindowNow), false);
});

test("scheduleSessionIdempotencyKey is stable per assignment window", () => {
  assert.equal(
    scheduleSessionIdempotencyKey("assignment-1", windowStart),
    `schedule-session:assignment-1:${windowStart}`,
  );
});

test("auth rejects missing and invalid tokens", async () => {
  const supabase = makeSupabase();
  const missing = await runScheduleSessionCron(supabase.client as never, { env: baseEnv, callerToken: "" });
  assert.equal(missing.status, 401);

  const invalid = await runScheduleSessionCron(supabase.client as never, { env: baseEnv, callerToken: "wrong" });
  assert.equal(invalid.status, 403);
});

test("account in active window queues one scheduled run", async () => {
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: async () => ({ schedulerConnected: true, status: "active" }),
  });

  assert.equal(run.status, 200);
  if (run.status !== 200) return;
  assert.equal(run.result.state, "active");
  assert.equal(run.result.scheduler_enabled, true);
  assert.equal(run.result.summary.eligible_count, 1);
  assert.equal(run.result.summary.queued_count, 1);
  assert.equal(supabase.rpcCalls.length, 3);
  assert.equal(supabase.rpcCalls[0]?.name, "get_valid_scheduled_session_preflight");
  assert.equal(supabase.rpcCalls[1]?.name, "create_account_run_request");
  assert.equal(supabase.rpcCalls[2]?.name, "handoff_preflight_device_lock_to_request");
  assert.equal(supabase.rpcCalls[1]?.args.p_requested_run_type, "account_session");
  assert.equal((supabase.rpcCalls[1]?.args.p_metadata_safe as Record<string, unknown>)?.trigger, "scheduler");
  assert.equal((supabase.rpcCalls[1]?.args.p_metadata_safe as Record<string, unknown>)?.business_action_deadline, "2026-06-30T09:50:00.000Z");
});

test("technical disable is reported as technical_disabled without any read", async () => {
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_ENABLED: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.state, "technical_disabled");
  assert.equal(run.result.reason, "technical_disabled");
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("scheduler toggle OFF yields scheduler_disabled and zero automatic request", async () => {
  const supabase = makeSupabase({ schedulerEnabled: false });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.state, "scheduler_disabled");
  assert.equal(run.result.reason, "scheduler_disabled");
  assert.equal(run.result.scheduler_enabled, false);
  assert.equal(run.result.skipped, true);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("dry run state stays observable and never enqueues even with scheduler ON", async () => {
  const supabase = makeSupabase({ schedulerEnabled: true });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.state, "dry_run");
  assert.equal(run.result.dry_run, true);
  assert.equal(run.result.summary.eligible_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("atomic RPC scheduler_disabled rejection is counted, not fatal", async () => {
  const supabase = makeSupabase({ rpcError: { message: "scheduler_disabled" } });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.skipped_scheduler_disabled_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(supabase.rpcCalls.some((call) => call.name === "create_account_run_request"), true);
});

test("scheduler settings read failure fails closed (no automatic request)", async () => {
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
    loadSchedulerAuthorization: async () => ({
      enabled: false,
      allowed: false,
      reason: "scheduler_disabled",
      settingsAvailable: false,
    }),
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.state, "scheduler_disabled");
  assert.equal(supabase.rpcCalls.length, 0);
});

test("CP2: expired scheduled window rolls forward to today's derived occurrence, without any run", async () => {
  // Stored window: July 3rd 06:00–12:00 local (04:00–10:00 UTC), expired.
  const supabase = makeSupabase({
    schedulerEnabled: false,
    assignments: [{
      ...defaultAssignment,
      starts_at: "2026-07-03T04:00:00.000Z",
      ends_at: "2026-07-03T10:00:00.000Z",
    }],
  });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-07-06T03:00:00.000Z"), // 05:00 local, before today's slot
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  // The derivation happens even while the Scheduler toggle is OFF…
  assert.equal(run.result.state, "scheduler_disabled");
  assert.equal(run.result.summary.rolled_forward_count, 1);
  assert.equal(supabase.assignmentUpdates.length, 1);
  const update = supabase.assignmentUpdates[0];
  assert.equal(update.starts_at, "2026-07-06T04:00:00.000Z");
  assert.equal(update.ends_at, "2026-07-06T10:00:00.000Z");
  const recurrence = (update.metadata as Record<string, unknown>).recurrence as Record<string, unknown>;
  assert.equal(recurrence.source, "schedule_session_cron");
  assert.equal(recurrence.previous_ends_at, "2026-07-03T10:00:00.000Z");
  assert.equal(recurrence.local_slot, "06:00-12:00");
  // …but it NEVER creates a run: zero RPC, zero enqueue.
  assert.equal(supabase.rpcCalls.length, 0);
  assert.equal(run.result.summary.queued_count, 0);
});

test("CP2: dry run derives nothing and writes nothing", async () => {
  const supabase = makeSupabase({
    assignments: [{
      ...defaultAssignment,
      starts_at: "2026-07-03T04:00:00.000Z",
      ends_at: "2026-07-03T10:00:00.000Z",
    }],
  });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv, // dry-run
    callerToken: "cron-token",
    now: new Date("2026-07-06T03:00:00.000Z"),
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.rolled_forward_count, 0);
  assert.equal(supabase.assignmentUpdates.length, 0);
});

test("CP2: a fresh window is an idempotent no-op for the roll-forward", async () => {
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.rolled_forward_count, 0);
  assert.equal(run.result.summary.roll_forward_failed_count, 0);
  assert.equal(supabase.assignmentUpdates.length, 0);
});

test("CP2: a window that cannot express a daily slot is left untouched and counted", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: false,
    assignments: [{
      ...defaultAssignment,
      // 30h window: not a daily slot — never invented, explicitly counted.
      starts_at: "2026-07-03T00:00:00.000Z",
      ends_at: "2026-07-04T06:00:00.000Z",
    }],
  });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-07-06T03:00:00.000Z"),
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.rolled_forward_count, 0);
  assert.equal(run.result.summary.roll_forward_failed_count, 1);
  assert.equal(supabase.assignmentUpdates.length, 0);
});

test("CP2: manual_only assignments are never materialized (hard exclusion)", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: false,
    assignments: [{
      ...defaultAssignment,
      schedule_mode: "manual_only",
      starts_at: "2026-07-03T04:00:00.000Z",
      ends_at: "2026-07-03T10:00:00.000Z",
    }],
  });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-07-06T03:00:00.000Z"),
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.rolled_forward_count, 0);
  assert.equal(run.result.summary.roll_forward_failed_count, 0);
  assert.equal(supabase.assignmentUpdates.length, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("account outside active window produces zero runs", async () => {
  const supabase = makeSupabase({ assignments: [] });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: beforeWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
  });

  assert.equal(run.status, 200);
  if (run.status !== 200) return;
  assert.equal(run.result.reason, "no_active_windows");
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("two ticks in same window do not double enqueue", async () => {
  const idempotencyKey = scheduleSessionIdempotencyKey("assignment-1", windowStart);
  const supabase = makeSupabase({
    activeRequests: [{
      account_id: "account-1",
      status: "queued",
      idempotency_key: idempotencyKey,
      metadata_safe: { trigger: "scheduler" },
    }],
  });

  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.result.summary.skipped_duplicate_slot_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
});

test("active run blocks second scheduled launch", async () => {
  const supabase = makeSupabase({
    activeRuns: [{ account_id: "account-1", status: "running" }],
  });

  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.result.summary.skipped_active_run_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
});

test("phone busy blocks scheduled launch for peer account", async () => {
  const supabase = makeSupabase({
    assignments: [
      defaultAssignment,
      { account_id: "account-peer", device_id: "device-1", status: "reserved", schedule_mode: "scheduled" },
    ],
    activeRuns: [{ account_id: "account-peer", status: "running" }],
  });

  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.result.summary.skipped_phone_busy_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
});

test("stale device heartbeat blocks launch", async () => {
  const supabase = makeSupabase({
    heartbeats: [{
      device_id: "device-1",
      status: "online",
      last_seen_at: new Date(inWindowNow.getTime() - 60 * 60_000).toISOString(),
    }],
  });

  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.result.summary.skipped_stale_device_count, 1);
});

test("emulator device blocks launch", async () => {
  const supabase = makeSupabase({
    devices: [{
      id: "device-1",
      device_kind: "emulator",
      status: "available",
      timezone: "UTC",
    }],
  });

  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.result.summary.skipped_emulator_device_count, 1);
});

test("BotApp runtime unavailable blocks enqueue despite active window", async () => {
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: async () => ({ schedulerConnected: false, status: "unavailable" }),
  });

  assert.equal(run.result.reason, "botapp_runtime_unavailable");
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(run.result.summary.skipped_botapp_runtime_unavailable_count, 1);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("login required blocks scheduled launch", async () => {
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: false, reason: "login_not_connected" }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.result.summary.skipped_eligibility_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
});

test("welcome_real_send_disabled reports scheduler launch block action", async () => {
  process.env.SCHEDULER_LAUNCH_BLOCK_NOTIFICATIONS_ENABLED = "false";
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: false, reason: "welcome_real_send_disabled" }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.result.summary.skipped_eligibility_count, 1);
  assert.equal(run.result.summary.scheduler_launch_block_reported_count, 1);
  const upsert = supabase.rpcCalls.find((call) => call.name === "upsert_account_dashboard_action");
  assert.ok(upsert);
  assert.equal(upsert?.args.p_action_type, "scheduler_launch_blocked");
  assert.equal((upsert?.args.p_metadata as Record<string, unknown>).reason_code, "welcome_real_send_disabled");
});

test("manual_only assignment is excluded by active window query", async () => {
  const supabase = makeSupabase({
    assignments: [],
  });

  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
  });

  assert.equal(run.result.reason, "no_active_windows");
});

test("extractScheduleSessionCronToken reads bearer and header", () => {
  const bearer = new Request("https://example.com", {
    headers: { authorization: "Bearer abc123" },
  });
  assert.equal(extractScheduleSessionCronToken(bearer), "abc123");

  const header = new Request("https://example.com", {
    headers: { "x-instagram-schedule-session-cron-token": "header-secret" },
  });
  assert.equal(extractScheduleSessionCronToken(header), "header-secret");
});

test("readScheduleSessionCronEnv defaults to disabled dry-run", () => {
  const env = readScheduleSessionCronEnv({});
  assert.equal(env.enabled, false);
  assert.equal(env.dryRun, true);
});
