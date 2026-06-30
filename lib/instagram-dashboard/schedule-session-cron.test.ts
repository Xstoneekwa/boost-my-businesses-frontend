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
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table === "account_assignments") {
          const rows = overrides.assignments ?? [defaultAssignment];
          const query = makeQueryResult(rows);
          return {
            ...query,
            eq: (column: string, value: unknown) => {
              if (column === "schedule_mode" && value === "scheduled") {
                return makeQueryResult(rows.filter((row) => row.schedule_mode === "scheduled"));
              }
              return query;
            },
          };
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
  });

  assert.equal(run.status, 200);
  if (run.status !== 200) return;
  assert.equal(run.result.summary.eligible_count, 1);
  assert.equal(run.result.summary.queued_count, 1);
  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0]?.name, "create_account_run_request");
  assert.equal(supabase.rpcCalls[0]?.args.p_requested_run_type, "account_session");
  assert.equal((supabase.rpcCalls[0]?.args.p_metadata_safe as Record<string, unknown>)?.trigger, "scheduler");
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
  });

  assert.equal(run.result.summary.skipped_emulator_device_count, 1);
});

test("login required blocks scheduled launch", async () => {
  const supabase = makeSupabase();
  const run = await runScheduleSessionCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: inWindowNow,
    evaluateEligibility: async () => ({ ok: false, reason: "login_not_connected" }),
  });

  assert.equal(run.result.summary.skipped_eligibility_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
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
