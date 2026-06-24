import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectClientReadinessStatus } from "./client-readiness-projection.ts";
import { runReadinessNow } from "../instagram-dashboard/readiness-now.ts";
import { enqueueClientConnectRequest } from "./enqueue-client-connect.ts";

type Row = Record<string, unknown>;

const accountId = "account-lucie-1";
const assignmentId = "assignment-1";
const deviceId = "device-physical-b";
const appInstanceId = "clone-b-1";

function baseRows(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    ig_accounts: [{ id: accountId, username: "demo", status: "active", admin_lifecycle_status: "active" }],
    account_credentials: [{ account_id: accountId, status: "active", reauth_required: true }],
    client_instagram_accounts: [{ account_id: accountId, login_status: "unknown", provisioning_status: "not_started", onboarding_status: "pending" }],
    account_package_summary: [{ account_id: accountId, runtime_profiles: ["full_cycle"], package_caps: { follow_day: 20, follow_session: 20 }, entitlements: [] }],
    ig_account_settings: [{ account_id: accountId }],
    ig_account_filters: [{ account_id: accountId }],
    ig_account_dm_settings: [],
    ig_targets: [],
    account_assignments: [{
      id: assignmentId,
      account_id: accountId,
      device_id: deviceId,
      app_instance_id: appInstanceId,
      starts_at: "2026-06-22T07:00:00.000Z",
      ends_at: "2026-06-22T13:00:00.000Z",
      status: "reserved",
    }],
    phone_devices: [{ id: deviceId, status: "available", device_kind: "physical_phone" }],
    phone_app_instances: [{ id: appInstanceId, device_id: deviceId, status: "available", usable_for_auto_login: true, is_launchable: true, current_account_id: null }],
    account_run_requests: [],
    ig_runs: [],
    account_dashboard_actions: [],
    ...overrides,
  };
}

function makeQuery(rows: Row[]) {
  const filters: Array<(row: Row) => boolean> = [];
  let maxRows = rows.length;
  const buildResult = () => ({
    data: rows.filter((row) => filters.every((filter) => filter(row))).slice(0, maxRows),
    error: null,
  });
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
      return {
        maybeSingle: () => Promise.resolve({ data: buildResult().data[0] ?? null, error: null }),
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve(buildResult()).then(resolve),
      };
    },
    maybeSingle: () => Promise.resolve({ data: buildResult().data[0] ?? null, error: null }),
    then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve(buildResult()).then(resolve),
  };
  return query;
}

function makeSupabase(rows = baseRows(), slotAvailable = false, rpcError: string | null = null) {
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
              slots: slotAvailable ? [{ available: true, starts_at: "2026-06-22T07:00:00.000Z", ends_at: "2026-06-22T13:00:00.000Z" }] : [],
              app_instance_availability: { available: 1 },
            },
            error: null,
          });
        }
        if (name === "create_account_run_request") {
          if (rpcError) {
            return Promise.resolve({ data: null, error: { message: rpcError } });
          }
          return Promise.resolve({ data: { id: "request-1", status: "queued" }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

test("check readiness route forces passive mode in connect-account helper", () => {
  const route = readFileSync(
    new URL("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(route, /readBoolean\(body\?\.dry_run/);
  assert.match(route, /checkClientAccountReadiness/);
});

test("connect route blocks when passive readiness is not satisfied", () => {
  const route = readFileSync(
    new URL("../../app/api/instagram-client/accounts/[accountId]/connect/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /connect_readiness_not_satisfied/);
  assert.match(route, /passive_blocked/);
});

test("passive readiness with valid A16-02-style assignment returns ready_to_connect without enqueue", async () => {
  const supabase = makeSupabase();
  const result = await runReadinessNow(supabase.client, {
    accountId,
    audience: "client",
    dryRun: true,
    mode: "readiness_only",
    now: new Date("2026-06-22T03:00:00.000Z"),
  });
  assert.equal(result.client_status, "ready_to_connect");
  assert.equal(result.preflight_request_created, false);
  assert.equal(supabase.rpcCalls.some((call) => call.name === "create_account_run_request"), false);
  assert.equal(projectClientReadinessStatus(result), "ready_to_connect");
});

test("passive readiness without assignment returns preparation_pending and no login", async () => {
  const supabase = makeSupabase(baseRows({ account_assignments: [] }), true);
  const result = await runReadinessNow(supabase.client, {
    accountId,
    audience: "client",
    dryRun: true,
    mode: "readiness_only",
    now: new Date("2026-06-22T03:00:00.000Z"),
  });
  assert.equal(projectClientReadinessStatus(result), "preparation_pending");
  assert.equal(supabase.rpcCalls.some((call) => call.name === "create_account_run_request"), false);
});

test("passive readiness with offline phone returns device_temporarily_unavailable", async () => {
  const supabase = makeSupabase(baseRows({
    phone_devices: [{ id: deviceId, status: "offline", device_kind: "physical_phone" }],
  }));
  const result = await runReadinessNow(supabase.client, {
    accountId,
    audience: "client",
    dryRun: true,
    mode: "readiness_only",
    now: new Date("2026-06-22T03:00:00.000Z"),
  });
  assert.equal(projectClientReadinessStatus(result), "device_temporarily_unavailable");
  assert.equal(supabase.rpcCalls.some((call) => call.name === "create_account_run_request"), false);
});

test("connect enqueue uses attempt-scoped idempotency and creates a new request", async () => {
  const supabase = makeSupabase();
  const result = await enqueueClientConnectRequest(supabase.client, {
    accountId,
    actorId: "actor-1",
    assignmentId,
    deadlineAt: "2026-06-22T10:00:00.000Z",
  });
  assert.equal(result.preflight_request_created, true);
  assert.equal(supabase.rpcCalls.filter((call) => call.name === "create_account_run_request").length, 1);
  assert.equal(supabase.rpcCalls[0]?.args.p_requested_run_type, "login_provisioning");
  assert.equal(supabase.rpcCalls[0]?.args.p_actor_type, "client");
  assert.equal(supabase.rpcCalls[0]?.args.p_source_surface, "instagram_client_connect");
  assert.match(String(supabase.rpcCalls[0]?.args.p_idempotency_key), /^login-preflight-now:assignment-1:/);
});

test("connect enqueue maps rpc invalid_actor_type to rejected enqueue", async () => {
  const supabase = makeSupabase(baseRows(), false, "invalid_actor_type");
  const result = await enqueueClientConnectRequest(supabase.client, {
    accountId,
    actorId: "actor-1",
    assignmentId,
    deadlineAt: "2026-06-22T10:00:00.000Z",
  });
  assert.equal(result.preflight_request_created, false);
  assert.equal(result.blockers.includes("enqueue_rejected"), true);
});

test("connect duplicate active request returns already_requested without second rpc", async () => {
  const supabase = makeSupabase(baseRows({
    account_run_requests: [{
      id: "request-existing",
      account_id: accountId,
      status: "queued",
      requested_run_type: "login_provisioning",
      idempotency_key: `login-preflight-now:${assignmentId}:attempt-old`,
    }],
  }));
  const result = await enqueueClientConnectRequest(supabase.client, {
    accountId,
    actorId: "actor-1",
    assignmentId,
    deadlineAt: "2026-06-22T10:00:00.000Z",
  });
  assert.equal(result.idempotent, true);
  assert.equal(result.reason, "already_requested");
  assert.equal(supabase.rpcCalls.some((call) => call.name === "create_account_run_request"), false);
});

test("passive readiness stays ready_to_connect without dm settings or targets", async () => {
  const supabase = makeSupabase(baseRows({
    ig_account_dm_settings: [],
    ig_targets: [],
  }));
  const result = await runReadinessNow(supabase.client, {
    accountId,
    audience: "client",
    dryRun: true,
    mode: "readiness_only",
    now: new Date("2026-06-22T03:00:00.000Z"),
  });
  assert.equal(result.client_status, "ready_to_connect");
  assert.equal(projectClientReadinessStatus(result), "ready_to_connect");
  assert.equal(result.blockers.includes("missing_dm_settings"), false);
  assert.equal(result.blockers.includes("missing_ct"), false);
});

test("client UI sends explicit passive payload for readiness check", () => {
  const ui = readFileSync(
    new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /dry_run: true, mode: "readiness_only"/);
  assert.match(ui, /dry_run: false, mode: "connect_enqueue"/);
  assert.match(ui, /window\.confirm/);
});

test("dm welcome non-regression helpers remain wired", () => {
  const dmService = readFileSync(new URL("./account-dm-capacity.ts", import.meta.url), "utf8");
  const domainService = readFileSync(new URL("../instagram-dashboard/dm-domain-service.ts", import.meta.url), "utf8");
  assert.match(dmService, /packageIncludesWelcomeDm/);
  assert.match(domainService, /resolveAccountWelcomeServiceActive/);
});
