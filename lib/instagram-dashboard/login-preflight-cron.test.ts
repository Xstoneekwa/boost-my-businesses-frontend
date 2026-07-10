import assert from "node:assert/strict";
import test from "node:test";

import {
  extractLoginPreflightCronToken,
  readLoginPreflightCronEnv,
  runLoginPreflightCron,
} from "./login-preflight-cron.ts";

const baseEnv = {
  INSTAGRAM_LOGIN_PREFLIGHT_CRON_TOKEN: "cron-token",
  INSTAGRAM_LOGIN_PREFLIGHT_CRON_ENABLED: "true",
  INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "true",
  INSTAGRAM_LOGIN_PREFLIGHT_CRON_LIMIT: "5",
};

function makeRequest(headers = {}) {
  return new Request("https://example.test/api/instagram-dashboard/login-preflight/cron", { headers });
}

const defaultAssignments = [
  {
    id: "assignment-needs-login",
    account_id: "account-needs-login",
    device_id: "device-1",
    app_instance_id: "app-1",
    starts_at: "2026-06-09T08:10:00.000Z",
    ends_at: "2026-06-09T08:30:00.000Z",
    status: "reserved",
    schedule_mode: "scheduled",
    assignment_type: "full_cycle",
  },
  {
    id: "assignment-connected",
    account_id: "account-connected",
    device_id: "device-2",
    app_instance_id: "app-2",
    starts_at: "2026-06-09T08:04:00.000Z",
    ends_at: "2026-06-09T08:24:00.000Z",
    status: "reserved",
    schedule_mode: "scheduled",
    assignment_type: "full_cycle",
  },
];

const defaultStatuses = [
  {
    account_id: "account-needs-login",
    login_status: "unknown",
    provisioning_status: "not_started",
    onboarding_status: "pending",
  },
  {
    account_id: "account-connected",
    login_status: "connected",
    provisioning_status: "ready",
    onboarding_status: "ready",
  },
];

function makeMaybeSingleQuery(row: unknown = null) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    gte: () => query,
    lte: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return query;
}

function makeQueryResult(rows: unknown[]) {
  const payload = { data: rows, error: null };
  const singlePayload = { data: rows[0] ?? null, error: null };
  const query = {
    select: () => query,
    in: () => query,
    gte: () => query,
    lte: () => query,
    order: () => query,
    eq: () => query,
    limit: (count?: number) => {
      if (typeof count !== "number") {
        return Promise.resolve(payload);
      }
      return {
        maybeSingle: () => Promise.resolve(singlePayload),
        then: (
          onFulfilled: (value: typeof payload) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise.resolve(payload).then(onFulfilled, onRejected),
      };
    },
    maybeSingle: () => Promise.resolve(singlePayload),
  };
  return query;
}

function makeSupabase(overrides: {
  assignments?: Array<Record<string, unknown>>;
  statuses?: Array<Record<string, unknown>>;
  activeRequests?: Array<Record<string, unknown>>;
  activeRuns?: Array<Record<string, unknown>>;
  schedulerEnabled?: boolean;
  preflights?: Array<Record<string, unknown>>;
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const devices = [
    { id: "device-1", device_kind: "physical_phone", status: "online", timezone: "Africa/Johannesburg" },
    { id: "device-2", device_kind: "physical_phone", status: "online", timezone: "Africa/Johannesburg" },
    { id: "device-peer", device_kind: "physical_phone", status: "online", timezone: "Africa/Johannesburg" },
  ];
  const heartbeats = [
    { device_id: "device-1", status: "online", last_seen_at: "2026-06-09T07:59:00.000Z" },
    { device_id: "device-2", status: "online", last_seen_at: "2026-06-09T07:59:00.000Z" },
    { device_id: "device-peer", status: "online", last_seen_at: "2026-06-09T07:59:00.000Z" },
  ];
  const appInstances = [
    { id: "app-1", package_name: "com.instagram.android.clone1" },
    { id: "app-2", package_name: "com.instagram.android.clone2" },
    { id: "app-peer", package_name: "com.instagram.android.clone3" },
  ];
  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table === "account_assignments") {
          return makeQueryResult(overrides.assignments ?? defaultAssignments);
        }
        if (table === "ig_accounts") {
          return makeQueryResult((overrides.statuses ?? defaultStatuses).map((row) => ({
            id: readString(row.id) || readString(row.account_id),
            username: row.username ?? `user_${readString(row.account_id ?? row.id).slice(-5)}`,
          })));
        }
        if (table === "account_run_requests") {
          return makeQueryResult(overrides.activeRequests ?? []);
        }
        if (table === "auto_restart_device_locks") {
          return makeMaybeSingleQuery(null);
        }
        if (table === "ig_runs") {
          return makeQueryResult(overrides.activeRuns ?? []);
        }
        if (table === "phone_devices") {
          return makeQueryResult(devices);
        }
        if (table === "device_heartbeats") {
          return makeQueryResult(heartbeats);
        }
        if (table === "phone_app_instances") {
          return makeQueryResult(appInstances);
        }
        if (table === "scheduled_session_preflights") {
          return makeQueryResult(overrides.preflights ?? []);
        }
        if (table === "auto_restart_settings") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { auto_restart_enabled: overrides.schedulerEnabled === true },
                  error: null,
                }),
              }),
            }),
          };
        }
        return makeQueryResult([]);
      },
      rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "auto_restart_acquire_device_lock") {
          return Promise.resolve({ data: { ok: true, acquired: true, lease_id: "lease-1" }, error: null });
        }
        if (name === "auto_restart_bind_device_lock_to_request") {
          return Promise.resolve({ data: { ok: true, bound: true }, error: null });
        }
        if (name === "auto_restart_release_device_lock") {
          return Promise.resolve({ data: { ok: true, released: true }, error: null });
        }
        if (name === "cancel_account_run_request") {
          return Promise.resolve({ data: { ok: true }, error: null });
        }
        if (name === "upsert_scheduled_session_preflight") {
          return Promise.resolve({ data: { id: "preflight-1", status: "preflight_due" }, error: null });
        }
        if (name === "bind_scheduled_session_preflight_request") {
          return Promise.resolve({ data: { id: "preflight-1", status: "preflight_running" }, error: null });
        }
        return Promise.resolve({ data: { id: "request-1", status: "queued" }, error: null });
      },
    },
  };
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

test("readLoginPreflightCronEnv defaults to disabled dry-run", () => {
  const env = readLoginPreflightCronEnv({});
  assert.equal(env.enabled, false);
  assert.equal(env.dryRun, true);
  assert.equal(env.configuredToken, null);
});

test("readLoginPreflightCronEnv falls back to schedule session cron token", () => {
  const env = readLoginPreflightCronEnv({
    INSTAGRAM_SCHEDULE_SESSION_CRON_TOKEN: "shared-cron-token",
  });
  assert.equal(env.configuredToken, "shared-cron-token");
});

test("extractLoginPreflightCronToken reads bearer and custom header", () => {
  assert.equal(extractLoginPreflightCronToken(makeRequest({ Authorization: "Bearer cron-token" })), "cron-token");
  assert.equal(
    extractLoginPreflightCronToken(makeRequest({ "x-instagram-login-preflight-cron-token": "header-token" })),
    "header-token",
  );
});

test("runLoginPreflightCron blocks missing configured token", async () => {
  const supabase = makeSupabase();
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: {},
    callerToken: "anything",
  });

  assert.equal(run.status, 503);
  assert.equal(run.result.reason, "cron_token_not_configured");
});

test("runLoginPreflightCron skips when disabled", async () => {
  const supabase = makeSupabase();
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_ENABLED: "false" },
    callerToken: "cron-token",
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.skipped, true);
  assert.equal(run.result.reason, "cron_disabled");
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron dry-run reports scheduler-off skips without enqueue", async () => {
  const supabase = makeSupabase();
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.dry_run, true);
  assert.equal(run.result.summary.skipped_scheduler_off_count, 2);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron queues scheduled_session_preflight when scheduler ON and dry-run is false", async () => {
  const supabase = makeSupabase({ schedulerEnabled: true, assignments: [defaultAssignments[0]] });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.queued_count, 1);
  assert.equal(run.result.summary.dashboard_action_count, 1);
  const createCall = supabase.rpcCalls.find((call) => call.name === "create_account_run_request");
  assert.ok(createCall);
  assert.equal(createCall?.args.p_requested_run_type, "scheduled_session_preflight");
  assert.equal(createCall?.args.p_idempotency_key, "scheduled-preflight:assignment-needs-login:2026-06-09T08:10:00.000Z");
  const rpcNames = supabase.rpcCalls.map((call) => call.name);
  assert.ok(rpcNames.includes("upsert_scheduled_session_preflight"));
  assert.ok(rpcNames.includes("auto_restart_acquire_device_lock"), "acquires device UI lease");
  assert.ok(rpcNames.includes("auto_restart_bind_device_lock_to_request"), "binds device UI lease to request");
  assert.ok(rpcNames.includes("upsert_account_dashboard_action"), "still upserts dashboard action");
});

test("runLoginPreflightCron skips enqueue when device UI lease is unavailable", async () => {
  const supabase = makeSupabase({ schedulerEnabled: true, assignments: [defaultAssignments[0]] });
  supabase.client.rpc = ((name: string, args: Record<string, unknown>) => {
    supabase.rpcCalls.push({ name, args });
    if (name === "auto_restart_acquire_device_lock") {
      return Promise.resolve({ data: { ok: false, acquired: false, reason: "device_lease_unavailable" }, error: null });
    }
    if (name === "auto_restart_release_device_lock") {
      return Promise.resolve({ data: { ok: true, released: true }, error: null });
    }
    if (name === "cancel_account_run_request") {
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    return Promise.resolve({ data: { id: "request-1", status: "queued" }, error: null });
  }) as never;
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(run.result.summary.skipped_device_lease_unavailable_count, 1);
  const rpcNames = supabase.rpcCalls.map((call) => call.name);
  assert.ok(rpcNames.includes("cancel_account_run_request"), "cancels the request when lease unavailable");
});

test("runLoginPreflightCron skips assignments without device_id", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [{ ...defaultAssignments[0], device_id: "" }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_missing_assignment_target_count, 1);
  assert.equal(run.result.summary.eligible_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron skips assignments without app_instance_id", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [{ ...defaultAssignments[0], app_instance_id: "" }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_missing_assignment_target_count, 1);
  assert.equal(run.result.summary.eligible_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron still evaluates connected accounts for verification preflight", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [defaultAssignments[1]],
    statuses: [defaultStatuses[1]],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.eligible_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
});

test("runLoginPreflightCron skips active request on same account", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [defaultAssignments[0]],
    activeRequests: [{ account_id: "account-needs-login", status: "queued", requested_run_type: "account_session" }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_active_request_count, 1);
  assert.equal(run.result.summary.eligible_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron skips active run on same account", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [defaultAssignments[0]],
    activeRuns: [{ account_id: "account-needs-login", status: "running" }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_active_run_count, 1);
  assert.equal(run.result.summary.eligible_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron skips phone busy from active request on same device or app instance", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [
      defaultAssignments[0],
      {
        id: "assignment-peer",
        account_id: "account-peer",
        device_id: "device-1",
        app_instance_id: "app-peer",
        starts_at: "2026-06-09T08:10:00.000Z",
        ends_at: "2026-06-09T08:30:00.000Z",
        status: "active",
      },
    ],
    statuses: [...defaultStatuses, { account_id: "account-peer", login_status: "unknown", provisioning_status: "not_started" }],
    activeRequests: [{ account_id: "account-peer", status: "running", requested_run_type: "account_session" }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_phone_busy_count, 1);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron skips phone busy from active run on same device or app instance", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [
      defaultAssignments[0],
      {
        id: "assignment-peer",
        account_id: "account-peer",
        device_id: "device-peer",
        app_instance_id: "app-1",
        starts_at: "2026-06-09T08:10:00.000Z",
        ends_at: "2026-06-09T08:30:00.000Z",
        status: "active",
      },
    ],
    statuses: [...defaultStatuses, { account_id: "account-peer", login_status: "unknown", provisioning_status: "not_started" }],
    activeRuns: [{ account_id: "account-peer", status: "running" }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_phone_busy_count, 1);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron skips duplicate active preflight for same assignment phase", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [defaultAssignments[0]],
    activeRequests: [{
      account_id: "account-needs-login",
      status: "queued",
      requested_run_type: "login_provisioning",
      idempotency_key: "scheduled-preflight:assignment-needs-login:2026-06-09T08:10:00.000Z",
    }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_duplicate_preflight_count, 1);
  assert.equal(run.result.summary.eligible_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron skips enqueue when slot is already preflight_ready", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [defaultAssignments[0]],
    preflights: [{
      assignment_id: "assignment-needs-login",
      scheduled_window_start: "2026-06-09T08:10:00.000Z",
      status: "preflight_ready",
      request_id: "preflight-request-done",
    }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_preflight_ready_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron skips enqueue when slot is already preflight_running", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [defaultAssignments[0]],
    preflights: [{
      assignment_id: "assignment-needs-login",
      scheduled_window_start: "2026-06-09T08:10:00.000Z",
      status: "preflight_running",
      request_id: "preflight-request-active",
    }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_duplicate_preflight_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron still enqueues when preflight_due exists for same slot", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [defaultAssignments[0]],
    preflights: [{
      assignment_id: "assignment-needs-login",
      scheduled_window_start: "2026-06-09T08:10:00.000Z",
      status: "preflight_due",
      request_id: null,
    }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.queued_count, 1);
  assert.ok(supabase.rpcCalls.some((call) => call.name === "create_account_run_request"));
});

test("runLoginPreflightCron T5 queues verification preflight while scheduler ON", async () => {
  const t5Assignment = {
    ...defaultAssignments[0],
    starts_at: "2026-06-09T08:05:00.000Z",
    ends_at: "2026-06-09T08:25:00.000Z",
  };
  const unresolved = makeSupabase({ schedulerEnabled: true, assignments: [t5Assignment] });
  const queued = await runLoginPreflightCron(unresolved.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(queued.result.summary.queued_count, 1);
  const createCall = unresolved.rpcCalls.find((call) => call.name === "create_account_run_request");
  assert.equal(createCall?.args.p_idempotency_key, "scheduled-preflight:assignment-needs-login:2026-06-09T08:05:00.000Z");
});

test("runLoginPreflightCron does not enqueue when deadline is too close", async () => {
  const supabase = makeSupabase({
    schedulerEnabled: true,
    assignments: [{
      ...defaultAssignments[0],
      starts_at: "2026-06-09T08:02:00.000Z",
      ends_at: "2026-06-09T08:22:00.000Z",
    }],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_deadline_too_close_count, 1);
  assert.equal(run.result.summary.eligible_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron result and queued metadata do not expose phone app identifiers", async () => {
  const supabase = makeSupabase({ schedulerEnabled: true, assignments: [defaultAssignments[0]] });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });
  const createCall = supabase.rpcCalls.find((call) => call.name === "create_account_run_request");
  const returned = JSON.stringify(run.result);
  const metadata = JSON.stringify(createCall?.args.p_metadata_safe ?? {});

  for (const forbidden of ["device-1", "app-1", "password", "secret", "vault", "service_role", "adb"]) {
    assert.equal(returned.includes(forbidden), false);
    assert.equal(metadata.includes(forbidden), false);
  }
});
