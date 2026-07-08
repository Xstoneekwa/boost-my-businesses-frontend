import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureLateActiveWindowPreflight,
  hasLatePreflightRunway,
  isLateActiveWindowEligible,
  resolveExistingPreflightDisposition,
  scheduledPreflightIdempotencyKey,
} from "./late-active-window-preflight.ts";
import { deriveSessionTransitionTimestamps } from "./session-transition-buffer.ts";
import { runScheduleSessionCron } from "./schedule-session-cron.ts";

const windowStart = "2026-07-08T10:00:00.000Z";
const windowEnd = "2026-07-08T16:00:00.000Z";
const midWindowNow = new Date("2026-07-08T12:00:00.000Z");
const nearDeadlineNow = new Date("2026-07-08T15:45:00.000Z");
const afterDeadlineNow = new Date("2026-07-08T15:55:00.000Z");

const transition = deriveSessionTransitionTimestamps(windowStart, windowEnd)!;

const baseEnv = {
  INSTAGRAM_SCHEDULE_SESSION_CRON_TOKEN: "cron-token",
  INSTAGRAM_SCHEDULE_SESSION_CRON_ENABLED: "true",
  INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN: "false",
  INSTAGRAM_SCHEDULE_SESSION_CRON_LIMIT: "5",
};

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

function makeLatePreflightSupabase(overrides: {
  preflights?: Array<Record<string, unknown>>;
  reservations?: Array<Record<string, unknown>>;
  suppression?: Record<string, unknown> | null;
  deviceLock?: Record<string, unknown> | null;
  validPreflight?: Record<string, unknown> | null;
  leaseOk?: boolean;
  rpcError?: string;
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const leaseOk = overrides.leaseOk ?? true;
  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table === "scheduled_session_preflights") {
          return makeQueryResult(overrides.preflights ?? []);
        }
        if (table === "client_provisioning_slot_reservations") {
          return makeQueryResult(overrides.reservations ?? []);
        }
        if (table === "auto_restart_device_locks") {
          return makeQueryResult(overrides.deviceLock ? [overrides.deviceLock] : []);
        }
        return makeQueryResult([]);
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (overrides.rpcError) {
          return { data: null, error: { message: overrides.rpcError } };
        }
        if (name === "get_active_operator_stop_suppression") {
          return { data: overrides.suppression ?? null, error: null };
        }
        if (name === "get_valid_scheduled_session_preflight") {
          return { data: overrides.validPreflight ?? null, error: null };
        }
        if (name === "upsert_scheduled_session_preflight") {
          return {
            data: {
              id: "preflight-late-1",
              status: args.p_status ?? "preflight_due",
              request_id: null,
              metadata_safe: args.p_metadata_safe ?? {},
            },
            error: null,
          };
        }
        if (name === "create_account_run_request") {
          return { data: [{ id: "preflight-request-late-1" }], error: null };
        }
        if (name === "bind_scheduled_session_preflight_request") {
          return { data: { id: "preflight-late-1", request_id: args.p_request_id }, error: null };
        }
        if (name === "auto_restart_acquire_device_lock") {
          return leaseOk
            ? { data: { ok: true, acquired: true, lease_id: "lease-1" }, error: null }
            : { data: { ok: false, acquired: false, reason: "device_lease_unavailable" }, error: null };
        }
        if (name === "auto_restart_bind_device_lock_to_request") {
          return leaseOk
            ? { data: { ok: true, bound: true }, error: null }
            : { data: { ok: false, bound: false, reason: "device_lock_bind_failed" }, error: null };
        }
        if (name === "cancel_account_run_request") {
          return { data: { ok: true }, error: null };
        }
        return { data: { ok: true }, error: null };
      },
    },
  };
}

test("late preflight eligibility requires active window and runway", () => {
  assert.equal(isLateActiveWindowEligible(transition, midWindowNow), true);
  assert.equal(hasLatePreflightRunway(transition, nearDeadlineNow), false);
  assert.equal(isLateActiveWindowEligible(transition, nearDeadlineNow), false);
  assert.equal(isLateActiveWindowEligible(transition, afterDeadlineNow), false);
});

test("existing blocked preflight does not loop", () => {
  const disposition = resolveExistingPreflightDisposition({
    status: "preflight_blocked",
    request_id: "req-1",
    id: "pf-1",
  });
  assert.equal(disposition?.ok, false);
  if (disposition && !disposition.ok) {
    assert.equal(disposition.reason, "late_preflight_blocked");
  }
});

test("existing running preflight returns already_running", () => {
  const disposition = resolveExistingPreflightDisposition({
    status: "preflight_running",
    request_id: "req-1",
    id: "pf-1",
  });
  assert.equal(disposition?.ok, true);
  if (disposition?.ok) {
    assert.equal(disposition.outcome, "already_running");
  }
});

test("scheduler ON mid-window with no preflight creates late preflight request", async () => {
  const supabase = makeLatePreflightSupabase();
  const result = await ensureLateActiveWindowPreflight(supabase.client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: midWindowNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: midWindowNow.toISOString(),
    heartbeatStatus: "online",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.outcome, "started");
    assert.equal(result.reason, "late_preflight_started");
  }
  assert.equal(supabase.rpcCalls.some((call) => call.name === "create_account_run_request"), true);
  const enqueue = supabase.rpcCalls.find((call) => call.name === "create_account_run_request");
  assert.equal(enqueue?.args.p_requested_run_type, "scheduled_session_preflight");
  assert.equal((enqueue?.args.p_metadata_safe as Record<string, unknown>)?.late_preflight, true);
  assert.equal((enqueue?.args.p_metadata_safe as Record<string, unknown>)?.verification_only, true);
});

test("phone offline blocks late preflight with stable reason", async () => {
  const result = await ensureLateActiveWindowPreflight(makeLatePreflightSupabase().client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: midWindowNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: "2026-07-08T08:00:00.000Z",
    heartbeatStatus: "online",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "stale_device_heartbeat");
});

test("active request blocks late preflight", async () => {
  const result = await ensureLateActiveWindowPreflight(makeLatePreflightSupabase().client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: midWindowNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: midWindowNow.toISOString(),
    heartbeatStatus: "online",
    activeRequestAccounts: new Set(["account-1"]),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "active_request_present");
});

test("active run blocks late preflight", async () => {
  const result = await ensureLateActiveWindowPreflight(makeLatePreflightSupabase().client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: midWindowNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: midWindowNow.toISOString(),
    heartbeatStatus: "online",
    activeRunAccounts: new Set(["account-1"]),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "active_run_present");
});

test("stop cleanup blocks late preflight", async () => {
  const supabase = makeLatePreflightSupabase({
    suppression: {
      id: "sup-1",
      account_id: "account-1",
      status: "active",
      reason_code: "operator_stop_suppressed",
      scheduled_window_start: windowStart,
      scheduled_window_end: windowEnd,
      suppressed_at: windowStart,
      expires_at: windowEnd,
      metadata_safe: {},
    },
  });
  const result = await ensureLateActiveWindowPreflight(supabase.client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: midWindowNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: midWindowNow.toISOString(),
    heartbeatStatus: "online",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "operator_stop_suppressed");
});

test("cp6 reservation conflict blocks late preflight", async () => {
  const supabase = makeLatePreflightSupabase({
    reservations: [{
      id: "res-1",
      window_start_utc: "2026-07-08T11:00:00.000Z",
      window_end_utc: "2026-07-08T13:00:00.000Z",
      status: "reserved",
    }],
  });
  const result = await ensureLateActiveWindowPreflight(supabase.client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: midWindowNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: midWindowNow.toISOString(),
    heartbeatStatus: "online",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "provisioning_reservation_conflict");
});

test("after business deadline blocks late preflight", async () => {
  const result = await ensureLateActiveWindowPreflight(makeLatePreflightSupabase().client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: afterDeadlineNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: afterDeadlineNow.toISOString(),
    heartbeatStatus: "online",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "late_preflight_too_close_to_deadline");
});

test("too close to deadline blocks late preflight", async () => {
  const result = await ensureLateActiveWindowPreflight(makeLatePreflightSupabase().client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: nearDeadlineNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: nearDeadlineNow.toISOString(),
    heartbeatStatus: "online",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "late_preflight_too_close_to_deadline");
});

test("scheduler OFF blocks late preflight", async () => {
  const result = await ensureLateActiveWindowPreflight(makeLatePreflightSupabase().client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: midWindowNow,
    schedulerEnabled: false,
    heartbeatLastSeenAt: midWindowNow.toISOString(),
    heartbeatStatus: "online",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "scheduler_disabled");
});

test("existing preflight_ready allows cold start without recreation", async () => {
  const supabase = makeLatePreflightSupabase({
    validPreflight: {
      id: "preflight-ready-1",
      request_id: "preflight-request-ready-1",
      status: "preflight_ready",
    },
  });
  const result = await ensureLateActiveWindowPreflight(supabase.client, {
    accountId: "account-1",
    assignmentId: "assignment-1",
    deviceId: "device-1",
    appInstanceId: "app-1",
    expectedPackage: "com.instagram.android",
    expectedUsername: "demo_user",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    now: midWindowNow,
    schedulerEnabled: true,
    heartbeatLastSeenAt: midWindowNow.toISOString(),
    heartbeatStatus: "online",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.outcome, "already_ready");
    assert.equal(result.reason, "late_preflight_ready");
  }
  assert.equal(supabase.rpcCalls.some((call) => call.name === "create_account_run_request"), false);
});

test("schedule-session-cron starts late preflight when canonical preflight missing", async () => {
  const activeRuntimeHealth = async () => ({ schedulerConnected: true, status: "active" });
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const supabase = {
    rpcCalls,
    from(table: string) {
      if (table === "auto_restart_settings") {
        return makeQueryResult([{ auto_restart_enabled: true }]);
      }
      if (table === "account_assignments") {
        return makeQueryResult([defaultAssignment]);
      }
      if (table === "phone_devices") {
        return makeQueryResult([{
          id: "device-1",
          device_kind: "physical_phone",
          status: "available",
          timezone: "Africa/Johannesburg",
        }]);
      }
      if (table === "device_heartbeats") {
        return makeQueryResult([{
          device_id: "device-1",
          status: "online",
          last_seen_at: midWindowNow.toISOString(),
        }]);
      }
      if (table === "phone_app_instances") {
        return makeQueryResult([{ id: "app-1", package_name: "com.instagram.android" }]);
      }
      if (table === "ig_accounts") {
        return makeQueryResult([{ id: "account-1", username: "demo_user" }]);
      }
      if (table === "scheduled_session_preflights") {
        return makeQueryResult([]);
      }
      if (table === "client_provisioning_slot_reservations") {
        return makeQueryResult([]);
      }
      if (table === "operator_stop_suppressions") {
        return makeQueryResult([]);
      }
      if (table === "auto_restart_device_locks") {
        return makeQueryResult([]);
      }
      return makeQueryResult([]);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "get_valid_scheduled_session_preflight") {
        return { data: null, error: null };
      }
      if (name === "get_active_operator_stop_suppression") {
        return { data: null, error: null };
      }
      if (name === "upsert_scheduled_session_preflight") {
        return {
          data: {
            id: "preflight-late-1",
            status: "preflight_due",
            request_id: null,
          },
          error: null,
        };
      }
      if (name === "create_account_run_request") {
        return { data: [{ id: "preflight-request-late-1" }], error: null };
      }
      if (name === "auto_restart_acquire_device_lock") {
        return { data: { ok: true, acquired: true, lease_id: "lease-1" }, error: null };
      }
      if (name === "auto_restart_bind_device_lock_to_request") {
        return { data: { ok: true, bound: true }, error: null };
      }
      if (name === "bind_scheduled_session_preflight_request") {
        return { data: { ok: true }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  };

  const response = await runScheduleSessionCron(supabase, {
    callerToken: "cron-token",
    env: baseEnv,
    now: midWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(response.status, 200);
  assert.equal(response.result.summary.late_preflight_started_count, 1);
  assert.equal(response.result.summary.queued_count, 0);
  assert.equal(response.result.summary.skipped_preflight_missing_count, 0);
  assert.equal(
    rpcCalls.some((call) => call.name === "create_account_run_request" && call.args.p_requested_run_type === "scheduled_session_preflight"),
    true,
  );
});

test("schedule-session-cron cold starts when late preflight already ready", async () => {
  const activeRuntimeHealth = async () => ({ schedulerConnected: true, status: "active" });
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let preflightLookupCount = 0;

  const supabase = {
    from(table: string) {
      if (table === "auto_restart_settings") return makeQueryResult([{ auto_restart_enabled: true }]);
      if (table === "account_assignments") return makeQueryResult([defaultAssignment]);
      if (table === "phone_devices") return makeQueryResult([{ id: "device-1", device_kind: "physical_phone", timezone: "UTC" }]);
      if (table === "device_heartbeats") return makeQueryResult([{ device_id: "device-1", status: "online", last_seen_at: midWindowNow.toISOString() }]);
      if (table === "phone_app_instances") return makeQueryResult([{ id: "app-1", package_name: "com.instagram.android" }]);
      if (table === "ig_accounts") return makeQueryResult([{ id: "account-1", username: "demo_user" }]);
      return makeQueryResult([]);
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "get_valid_scheduled_session_preflight") {
        preflightLookupCount += 1;
        return {
          data: {
            id: "preflight-ready-1",
            request_id: "preflight-request-ready-1",
            status: "preflight_ready",
          },
          error: null,
        };
      }
      if (name === "create_account_run_request") {
        return { data: [{ id: "scheduler-request-1" }], error: null };
      }
      if (name === "handoff_preflight_device_lock_to_request") {
        return { data: { ok: true }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  };

  const response = await runScheduleSessionCron(supabase, {
    callerToken: "cron-token",
    env: baseEnv,
    now: midWindowNow,
    evaluateEligibility: async () => ({ ok: true }),
    loadRuntimeHealth: activeRuntimeHealth,
  });

  assert.equal(response.status, 200);
  assert.equal(response.result.summary.queued_count, 1);
  assert.equal(response.result.summary.late_preflight_started_count, 0);
  assert.equal(preflightLookupCount >= 1, true);
  const schedulerEnqueue = rpcCalls.find((call) =>
    call.name === "create_account_run_request"
    && call.args.p_requested_run_type === "account_session");
  assert.ok(schedulerEnqueue);
});

test("preflight idempotency key stays stable for late and classic preflight", () => {
  assert.equal(
    scheduledPreflightIdempotencyKey("assignment-1", windowStart),
    "scheduled-preflight:assignment-1:2026-07-08T10:00:00.000Z",
  );
});
