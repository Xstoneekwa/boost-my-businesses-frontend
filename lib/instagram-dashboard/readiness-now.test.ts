import assert from "node:assert/strict";
import test from "node:test";

import { runReadinessNow } from "./readiness-now.ts";

type Row = Record<string, unknown>;

const accountId = "account-1";
const assignmentId = "assignment-1";

function baseRows(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    ig_accounts: [{ id: accountId, username: "demo", status: "active", admin_lifecycle_status: "active" }],
    account_credentials: [{ account_id: accountId, status: "active", reauth_required: false }],
    client_instagram_accounts: [{ account_id: accountId, login_status: "unknown", provisioning_status: "not_started", onboarding_status: "pending" }],
    account_assignments: [{
      id: assignmentId,
      account_id: accountId,
      device_id: "device-secret-1",
      app_instance_id: "app-secret-1",
      starts_at: "2026-06-09T08:00:00.000Z",
      ends_at: "2026-06-09T08:20:00.000Z",
      status: "active",
    }],
    phone_devices: [{ id: "device-secret-1", status: "online" }],
    phone_app_instances: [{ id: "app-secret-1", device_id: "device-secret-1", status: "available", usable_for_auto_login: true, is_launchable: true }],
    account_run_requests: [],
    ig_runs: [],
    ...overrides,
  };
}

function makeQuery(rows: Row[]) {
  const filters: Array<(row: Row) => boolean> = [];
  let maxRows = rows.length;
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => {
      filters.push((row) => row[field] === value);
      return query;
    },
    in: (field: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[field]));
      return query;
    },
    order: () => query,
    limit: (limit: number) => {
      maxRows = limit;
      return Promise.resolve({ data: rows.filter((row) => filters.every((filter) => filter(row))).slice(0, maxRows), error: null });
    },
  };
  return query;
}

function makeSupabase(rows = baseRows(), slotAvailable = false) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rpcCalls,
    client: {
      from(table: string) {
        return makeQuery((rows as Record<string, Row[]>)[table] ?? []);
      },
      rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "list_available_assignment_slots") {
          return Promise.resolve({
            data: {
              ok: true,
              slots: slotAvailable ? [{ available: true, starts_at: "2026-06-09T09:00:00.000Z", ends_at: "2026-06-09T09:20:00.000Z" }] : [],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { id: "request-safe-1", status: "queued" }, error: null });
      },
    },
  };
}

test("readiness now returns ready without request when account is connected", async () => {
  const supabase = makeSupabase(baseRows({
    client_instagram_accounts: [{ account_id: accountId, login_status: "connected", provisioning_status: "ready", onboarding_status: "ready" }],
  }));

  const result = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.equal(result.readiness_status, "ready");
  assert.equal(result.client_status, "connected_ready");
  assert.equal(result.preflight_request_created, false);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("readiness now returns needs_credentials when credentials are missing", async () => {
  const supabase = makeSupabase(baseRows({ account_credentials: [] }));

  const result = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.equal(result.readiness_status, "needs_credentials");
  assert.equal(result.client_status, "update_password");
  assert.equal(result.preflight_request_created, false);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("readiness now returns needs_credentials when active credentials require reauth", async () => {
  const supabase = makeSupabase(baseRows({
    account_credentials: [{ account_id: accountId, status: "active", reauth_required: true, reauth_reason: "awaiting_login_verification" }],
  }));

  const result = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.equal(result.readiness_status, "needs_credentials");
  assert.equal(result.client_status, "update_password");
  assert.equal(result.reason, "credentials_reauth_required");
  assert.equal(result.preflight_request_created, false);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("readiness now returns action required for 2FA", async () => {
  const supabase = makeSupabase(baseRows({
    client_instagram_accounts: [{ account_id: accountId, login_status: "needs_2fa", provisioning_status: "login_pending" }],
  }));

  const result = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.equal(result.readiness_status, "needs_login_verification");
  assert.equal(result.client_status, "action_required_2fa");
  assert.equal(result.next_action, "submit_2fa_code");
  assert.equal(supabase.rpcCalls.length, 0);
});

test("readiness now waits for scheduled assignment when no assignment exists but capacity is visible", async () => {
  const supabase = makeSupabase(baseRows({ account_assignments: [] }), true);

  const result = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.equal(result.readiness_status, "waiting_scheduled_assignment");
  assert.equal(result.client_status, "waiting_next_slot");
  assert.equal(result.preflight_request_created, false);
  assert.equal(supabase.rpcCalls[0].name, "list_available_assignment_slots");
});

test("readiness now returns retry_later when assigned phone or app is busy", async () => {
  const supabase = makeSupabase(baseRows({
    account_assignments: [
      ...baseRows().account_assignments,
      {
        id: "assignment-peer",
        account_id: "account-peer",
        device_id: "device-secret-1",
        app_instance_id: "app-peer",
        starts_at: "2026-06-09T08:00:00.000Z",
        ends_at: "2026-06-09T08:20:00.000Z",
        status: "active",
      },
    ],
    account_run_requests: [{ id: "busy-request", account_id: "account-peer", status: "running", requested_run_type: "account_session" }],
  }));

  const result = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.equal(result.reason, "skipped_phone_busy");
  assert.equal(result.client_status, "try_again_later");
  assert.equal(result.preflight_request_created, false);
  assert.equal(supabase.rpcCalls.length, 0);
});

test("readiness now creates login preflight request when assignment is free", async () => {
  const supabase = makeSupabase();

  const result = await runReadinessNow(supabase.client, {
    accountId,
    actorId: "admin-user",
    now: new Date("2026-06-09T08:01:00.000Z"),
  });

  assert.equal(result.readiness_status, "checking_connection");
  assert.equal(result.client_status, "checking_connection");
  assert.equal(result.preflight_request_created, true);
  assert.equal(result.request_id, "request-safe-1");
  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0].name, "create_account_run_request");
  assert.equal(supabase.rpcCalls[0].args.p_requested_run_type, "login_provisioning");
  assert.equal(supabase.rpcCalls[0].args.p_idempotency_key, "login-preflight-now:assignment-1");
});

test("readiness now retries when idempotent key returns a terminal request", async () => {
  let createCalls = 0;
  const supabase = makeSupabase();
  const baseRpc = supabase.client.rpc.bind(supabase.client);
  supabase.client.rpc = (name: string, args: Record<string, unknown>) => {
    if (name !== "create_account_run_request") return baseRpc(name, args);
    createCalls += 1;
    if (createCalls === 1) {
      return Promise.resolve({ data: { id: "stale-failed", status: "failed" }, error: null });
    }
    return Promise.resolve({ data: { id: "request-safe-retry", status: "queued" }, error: null });
  };

  const result = await runReadinessNow(supabase.client, {
    accountId,
    now: new Date("2026-06-09T08:01:00.000Z"),
  });

  assert.equal(createCalls, 2);
  assert.equal(result.preflight_request_created, true);
  assert.equal(result.run_request_status, "queued");
  assert.equal(result.request_id, "request-safe-retry");
});

test("readiness now duplicate click is idempotent and does not create another request", async () => {
  const supabase = makeSupabase(baseRows({
    account_run_requests: [{
      id: "existing-request",
      account_id: accountId,
      status: "queued",
      requested_run_type: "login_provisioning",
      idempotency_key: "login-preflight-now:assignment-1",
    }],
  }));

  const result = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.equal(result.idempotent, true);
  assert.equal(result.preflight_request_created, false);
  assert.equal(result.request_id, "existing-request");
  assert.equal(supabase.rpcCalls.length, 0);
});

test("readiness now client response does not expose technical identifiers", async () => {
  const supabase = makeSupabase();

  const result = await runReadinessNow(supabase.client, {
    accountId,
    audience: "client",
    now: new Date("2026-06-09T08:01:00.000Z"),
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.client_status, "checking_connection");
  assert.equal("phone_available" in result, false);
  assert.equal("app_instance_available" in result, false);
  assert.equal("request_id" in result, false);
  for (const forbidden of ["device-secret-1", "app-secret-1", "assignment-1", "adb", "vault", "secret", "service_role", "token", "password"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("readiness now admin response exposes safe ops status but no secrets", async () => {
  const supabase = makeSupabase();

  const result = await runReadinessNow(supabase.client, {
    accountId,
    audience: "admin",
    now: new Date("2026-06-09T08:01:00.000Z"),
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.phone_available, true);
  assert.equal(result.app_instance_available, true);
  assert.equal(result.request_id, "request-safe-1");
  for (const forbidden of ["device-secret-1", "app-secret-1", "adb", "vault", "secret_ref", "service_role", "password"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("readiness now does not create DM jobs", async () => {
  const supabase = makeSupabase();

  await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.deepEqual(supabase.rpcCalls.map((call) => call.name), ["create_account_run_request"]);
  assert.equal(supabase.rpcCalls.some((call) => /dm/i.test(call.name)), false);
});
