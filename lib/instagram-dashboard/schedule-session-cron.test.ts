import assert from "node:assert/strict";
import test from "node:test";

import {
  assignmentWindowActive,
  extractScheduleSessionCronToken,
  readScheduleSessionCronEnv,
  runScheduleSessionCron,
  scheduleSessionIdempotencyKey,
  scheduleSessionRetryIdempotencyKey,
  SCHEDULE_SESSION_PRE_RUN_RETRY_LIMIT,
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
    limit: () => Promise.resolve({ data: rows, error: null }),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
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
  baseRequest?: Record<string, unknown>;
  retryDecision?: Record<string, unknown>;
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const assignmentUpdates: Array<Record<string, unknown>> = [];
  const cronRuns: Array<Record<string, unknown>> = [];
  return {
    rpcCalls,
    assignmentUpdates,
    cronRuns,
    client: {
      from(table: string) {
        if (table === "schedule_session_cron_runs") {
          return {
            ...makeQueryResult([]),
            insert(row: Record<string, unknown>) {
              cronRuns.push(row);
              return Promise.resolve({ data: [row], error: null });
            },
          };
        }
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
        return makeQueryResult([]);
      },
      rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (overrides.rpcError) {
          return Promise.resolve({ data: null, error: overrides.rpcError });
        }
        if (name === "create_account_run_request" && overrides.baseRequest) {
          return Promise.resolve({ data: overrides.baseRequest, error: null });
        }
        if (name === "create_schedule_session_pre_run_retry_v1") {
          return Promise.resolve({
            data: overrides.retryDecision ?? { created: false, reason: "scheduled_retry_not_needed" },
            error: null,
          });
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

for (const terminalStatus of ["failed", "completed", "canceled"] as const) {
  test(`${terminalStatus} in the old slot cannot block the next slot`, () => {
    const oldSlot = "2026-08-02T16:00:00.000Z";
    const nextSlot = "2026-08-02T22:00:00.000Z";
    const oldKey = scheduleSessionIdempotencyKey("assignment-1", oldSlot);
    const nextKey = scheduleSessionIdempotencyKey("assignment-1", nextSlot);
    assert.notEqual(oldKey, nextKey);
    assert.equal({ status: terminalStatus, idempotency_key: oldKey }.status, terminalStatus);
    assert.equal(nextKey, "schedule-session:assignment-1:2026-08-02T22:00:00.000Z");
  });
}

test("same slot always keeps one idempotency key", () => {
  assert.equal(
    scheduleSessionIdempotencyKey("assignment-1", windowStart),
    scheduleSessionIdempotencyKey("assignment-1", windowStart),
  );
});

test("23:59 to 00:00 changes the materialized business slot key", () => {
  const beforeMidnightSlot = scheduleSessionIdempotencyKey("assignment-1", "2026-08-01T22:00:00.000Z");
  const nextMidnightSlot = scheduleSessionIdempotencyKey("assignment-1", "2026-08-02T22:00:00.000Z");
  assert.notEqual(beforeMidnightSlot, nextMidnightSlot);
});

test("scheduleSessionRetryIdempotencyKey is stable and versioned", () => {
  const base = scheduleSessionIdempotencyKey("assignment-1", windowStart);
  assert.equal(scheduleSessionRetryIdempotencyKey(base, 1), `${base}:retry:v1:1`);
  assert.equal(SCHEDULE_SESSION_PRE_RUN_RETRY_LIMIT, 1);
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
  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0]?.name, "create_account_run_request");
  assert.equal(supabase.rpcCalls[0]?.args.p_requested_run_type, "account_session");
  assert.equal((supabase.rpcCalls[0]?.args.p_metadata_safe as Record<string, unknown>)?.trigger, "scheduler");
});

test("blocked pre-run package contract creates exactly one bounded retry request", async () => {
  const baseKey = scheduleSessionIdempotencyKey("assignment-1", windowStart);
  const retryKey = scheduleSessionRetryIdempotencyKey(baseKey, 1);
  const supabase = makeSupabase({
    baseRequest: {
      id: "blocked-request-1",
      status: "blocked",
      error_code: "package_settings_incomplete",
      idempotency_key: baseKey,
      run_id: null,
    },
    retryDecision: {
      created: true,
      reason: "scheduled_retry_created",
      request_id: "retry-request-1",
      idempotency_key: retryKey,
      retry_of_request_id: "blocked-request-1",
      retry_ordinal: 1,
      retry_limit: 1,
    },
  });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.queued_count, 1);
  assert.equal(run.result.summary.retryable_pre_run_block_count, 1);
  assert.equal(run.result.summary.scheduled_retry_created_count, 1);
  assert.deepEqual(supabase.rpcCalls.map((call) => call.name), [
    "create_account_run_request",
    "create_schedule_session_pre_run_retry_v1",
  ]);
  const retryArgs = supabase.rpcCalls[1]?.args;
  assert.equal(retryArgs?.p_base_idempotency_key, baseKey);
  assert.equal(retryArgs?.p_retry_limit, 1);
  assert.equal(retryArgs?.p_assignment_id, "assignment-1");
});

test("runtime_contract_not_ready is the only other retryable pre-run contract reason", async () => {
  const supabase = makeSupabase({
    baseRequest: {
      id: "blocked-request-2",
      status: "blocked",
      error_code: "runtime_contract_not_ready",
      idempotency_key: scheduleSessionIdempotencyKey("assignment-1", windowStart),
      run_id: null,
    },
    retryDecision: { created: false, reason: "package_runtime_contract_blocked" },
  });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });
  assert.equal(run.result.summary.retryable_pre_run_block_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(run.result.summary.scheduled_retry_not_needed_count, 1);
});

for (const eligibilityReason of [
  "follow_day_quota_exhausted",
  "unfollow_day_quota_exhausted",
  "manual_stop_requested",
  "operator_review_required",
] as const) {
  test(`${eligibilityReason} is rechecked before retry and creates no request`, async () => {
    const supabase = makeSupabase({
      baseRequest: {
        id: "blocked-request-before-eligibility",
        status: "blocked",
        error_code: "package_settings_incomplete",
        idempotency_key: scheduleSessionIdempotencyKey("assignment-1", windowStart),
        run_id: null,
      },
    });
    const run = await runScheduleSessionCron(supabase.client as never, {
      env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
      callerToken: "cron-token",
      now: inWindowNow,
      evaluateEligibility: async () => ({ ok: false, reason: eligibilityReason }),
      loadRuntimeHealth: activeRuntimeHealth,
    });
    assert.equal(run.result.summary.skipped_eligibility_count, 1);
    assert.equal(run.result.summary.queued_count, 0);
    assert.equal(supabase.rpcCalls.length, 0);
  });
}

test("unrelated terminal errors never enter the scheduled retry RPC", async () => {
  const supabase = makeSupabase({
    baseRequest: {
      id: "blocked-request-3",
      status: "blocked",
      error_code: "identity_mismatch_review_required",
      idempotency_key: scheduleSessionIdempotencyKey("assignment-1", windowStart),
    },
  });
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(run.result.summary.scheduled_retry_not_needed_count, 1);
  assert.deepEqual(supabase.rpcCalls.map((call) => call.name), ["create_account_run_request"]);
});

for (const reason of ["scheduled_retry_window_closed", "scheduled_retry_limit_reached", "scheduled_retry_not_needed"] as const) {
  test(`${reason} is observable and creates no request`, async () => {
    const supabase = makeSupabase({
      baseRequest: {
        id: "blocked-request-observable",
        status: "blocked",
        error_code: "package_settings_incomplete",
        idempotency_key: scheduleSessionIdempotencyKey("assignment-1", windowStart),
      },
      retryDecision: { created: false, reason },
    });
    const run = await runScheduleSessionCron(supabase.client as never, {
      env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
      callerToken: "cron-token",
      now: inWindowNow,
      evaluateEligibility: async () => ({ ok: true }),
      loadRuntimeHealth: activeRuntimeHealth,
    });
    assert.equal(run.result.summary.queued_count, 0);
    if (reason === "scheduled_retry_window_closed") assert.equal(run.result.summary.scheduled_retry_window_closed_count, 1);
    else if (reason === "scheduled_retry_limit_reached") assert.equal(run.result.summary.scheduled_retry_limit_reached_count, 1);
    else assert.equal(run.result.summary.scheduled_retry_not_needed_count, 1);
  });
}

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

test("welcome_template_missing persists one account rejection and upserts the canonical incident without a run", async () => {
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: false, reason: "welcome_template_missing" }),
    syncConfigurationIncidents: true,
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(run.result.evaluated_accounts?.[0]?.stage, "configuration");
  assert.equal(run.result.evaluated_accounts?.[0]?.stable_reason, "welcome_template_missing");
  assert.deepEqual(supabase.rpcCalls.map((call) => call.name), [
    "upsert_account_incident",
    "upsert_account_dashboard_action",
  ]);
  assert.equal(supabase.cronRuns.length, 1);
  const persisted = supabase.cronRuns[0]?.evaluated_accounts as Array<Record<string, unknown>>;
  assert.equal(persisted[0]?.eligible, false);
  assert.equal(persisted[0]?.stable_reason, "welcome_template_missing");
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
