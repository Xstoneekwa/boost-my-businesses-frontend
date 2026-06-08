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
  },
  {
    id: "assignment-connected",
    account_id: "account-connected",
    device_id: "device-2",
    app_instance_id: "app-2",
    starts_at: "2026-06-09T08:04:00.000Z",
    ends_at: "2026-06-09T08:24:00.000Z",
    status: "reserved",
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

function makeQueryResult(rows: unknown[]) {
  const query = {
    select: () => query,
    in: () => query,
    gte: () => query,
    lte: () => query,
    order: () => query,
    eq: () => query,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return query;
}

function makeSupabase(overrides: {
  assignments?: Array<Record<string, unknown>>;
  statuses?: Array<Record<string, unknown>>;
  activeRequests?: Array<Record<string, unknown>>;
  activeRuns?: Array<Record<string, unknown>>;
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table === "account_assignments") {
          return makeQueryResult(overrides.assignments ?? defaultAssignments);
        }
        if (table === "client_instagram_accounts") {
          return makeQueryResult(overrides.statuses ?? defaultStatuses);
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

test("readLoginPreflightCronEnv defaults to disabled dry-run", () => {
  const env = readLoginPreflightCronEnv({});
  assert.equal(env.enabled, false);
  assert.equal(env.dryRun, true);
  assert.equal(env.configuredToken, null);
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

test("runLoginPreflightCron dry-run reports eligibility without enqueue", async () => {
  const supabase = makeSupabase();
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.dry_run, true);
  assert.equal(run.result.summary.eligible_count, 1);
  assert.equal(run.result.summary.queued_count, 0);
  assert.equal(run.result.summary.skipped_connected_count, 1);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron queues login_provisioning when enabled and dry-run is false", async () => {
  const supabase = makeSupabase();
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.summary.queued_count, 1);
  assert.equal(run.result.summary.dashboard_action_count, 1);
  assert.equal(supabase.rpcCalls[0].name, "create_account_run_request");
  assert.equal(supabase.rpcCalls[0].args.p_requested_run_type, "login_provisioning");
  assert.equal(supabase.rpcCalls[0].args.p_idempotency_key, "login-preflight:assignment-needs-login:t10");
  assert.deepEqual(
    supabase.rpcCalls[0].args.p_metadata_safe,
    {
      source: "login_preflight_cron",
      assignment_id: "assignment-needs-login",
      phase: "t10",
      worker_id: "login_preflight_cron",
      scheduled_session_at: "2026-06-09T08:10:00.000Z",
      scheduled_session_ends_at: "2026-06-09T08:30:00.000Z",
      deadline_at: "2026-06-09T08:09:00.000Z",
    },
  );
  assert.equal(supabase.rpcCalls[1].name, "upsert_account_dashboard_action");
});

test("runLoginPreflightCron skips assignments without device_id", async () => {
  const supabase = makeSupabase({
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

test("runLoginPreflightCron skips account already connected and ready", async () => {
  const supabase = makeSupabase({
    assignments: [defaultAssignments[1]],
    statuses: [defaultStatuses[1]],
  });
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: baseEnv,
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(run.result.summary.skipped_connected_count, 1);
  assert.equal(run.result.summary.eligible_count, 0);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("runLoginPreflightCron skips active request on same account", async () => {
  const supabase = makeSupabase({
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
    assignments: [defaultAssignments[0]],
    activeRequests: [{
      account_id: "account-needs-login",
      status: "queued",
      requested_run_type: "login_provisioning",
      idempotency_key: "login-preflight:assignment-needs-login:t10",
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

test("runLoginPreflightCron T5 queues only while account is still unresolved", async () => {
  const t5Assignment = {
    ...defaultAssignments[0],
    starts_at: "2026-06-09T08:05:00.000Z",
    ends_at: "2026-06-09T08:25:00.000Z",
  };
  const unresolved = makeSupabase({ assignments: [t5Assignment] });
  const queued = await runLoginPreflightCron(unresolved.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(queued.result.summary.queued_count, 1);
  assert.equal(unresolved.rpcCalls[0].args.p_idempotency_key, "login-preflight:assignment-needs-login:t5");

  const resolved = makeSupabase({
    assignments: [t5Assignment],
    statuses: [{ account_id: "account-needs-login", login_status: "connected", provisioning_status: "ready" }],
  });
  const skipped = await runLoginPreflightCron(resolved.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });

  assert.equal(skipped.result.summary.skipped_connected_count, 1);
  assert.equal(resolved.rpcCalls.length, 0);
});

test("runLoginPreflightCron does not enqueue when deadline is too close", async () => {
  const supabase = makeSupabase({
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
  const supabase = makeSupabase();
  const run = await runLoginPreflightCron(supabase.client as never, {
    env: { ...baseEnv, INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN: "false" },
    callerToken: "cron-token",
    now: new Date("2026-06-09T08:00:00.000Z"),
  });
  const returned = JSON.stringify(run.result);
  const metadata = JSON.stringify(supabase.rpcCalls[0].args.p_metadata_safe);

  for (const forbidden of ["device-1", "app-1", "password", "secret", "vault", "service_role", "adb"]) {
    assert.equal(returned.includes(forbidden), false);
    assert.equal(metadata.includes(forbidden), false);
  }
});
