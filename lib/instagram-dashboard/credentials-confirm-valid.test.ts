import assert from "node:assert/strict";
import test from "node:test";

import { confirmValidCredentials } from "./credentials-confirm-valid.ts";
import { runReadinessNow } from "./readiness-now.ts";

type Row = Record<string, unknown>;

const accountId = "account-1";

function baseRows(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    ig_accounts: [{ id: accountId, username: "demo", status: "active", admin_lifecycle_status: "active" }],
    account_credentials: [{
      account_id: accountId,
      provider: "instagram",
      status: "active",
      reauth_required: true,
      reauth_reason: "awaiting_login_verification",
      credentials_version: 1,
    }],
    client_instagram_accounts: [{ account_id: accountId, login_status: "unknown", provisioning_status: "not_started", onboarding_status: "pending" }],
    account_assignments: [{
      id: "assignment-1",
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
    ig_action_logs: [],
    ...overrides,
  };
}

function makeQuery(rows: Record<string, Row[]>, table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let maxRows = Number.POSITIVE_INFINITY;
  let updatePatch: Row | null = null;

  function selectedRows() {
    const tableRows = rows[table] ?? [];
    return tableRows.filter((row) => filters.every((filter) => filter(row))).slice(0, maxRows);
  }

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
    update: (patch: Row) => {
      updatePatch = patch;
      return query;
    },
    insert: (row: Row) => {
      rows[table] = rows[table] ?? [];
      rows[table].push(row);
      return Promise.resolve({ data: row, error: null });
    },
    limit: (limit: number) => {
      maxRows = limit;
      return query;
    },
    maybeSingle: () => {
      if (updatePatch) {
        const matches = selectedRows();
        for (const row of matches) Object.assign(row, updatePatch);
      }
      return Promise.resolve({ data: selectedRows()[0] ?? null, error: null });
    },
    then: (resolve: (value: { data: Row[]; error: null }) => void) => {
      resolve({ data: selectedRows(), error: null });
    },
  };
  return query;
}

function makeSupabase(rows = baseRows()) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rows,
    rpcCalls,
    client: {
      from(table: string) {
        return makeQuery(rows as Record<string, Row[]>, table);
      },
      rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return Promise.resolve({ data: { id: "request-safe-1", status: "queued" }, error: null });
      },
    },
  };
}

test("confirm valid clears active credential reauth without exposing secrets", async () => {
  const supabase = makeSupabase();

  const result = await confirmValidCredentials(supabase.client, { accountId, actorId: "admin-user" });
  const credential = supabase.rows.account_credentials[0];
  const serialized = JSON.stringify(result);

  assert.equal(result.status, "confirmed");
  assert.equal(result.credentials_status, "active");
  assert.equal(result.reauth_required, false);
  assert.equal(result.reauth_reason, null);
  assert.equal(credential.reauth_required, false);
  assert.equal(credential.reauth_reason, null);
  assert.equal(supabase.rows.ig_action_logs.length, 1);
  for (const forbidden of [
    "password",
    "secret_ref",
    "supabase_vault://",
    "service_role",
    "token",
    "device-secret-1",
    "app-secret-1",
    "adb",
    "raw_xml",
    "screenshot",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("confirm valid refuses missing or inactive credentials", async () => {
  const missing = makeSupabase(baseRows({ account_credentials: [] }));
  const missingResult = await confirmValidCredentials(missing.client, { accountId });
  assert.equal(missingResult.status, "credentials_missing");

  const inactive = makeSupabase(baseRows({
    account_credentials: [{ account_id: accountId, provider: "instagram", status: "revoked", reauth_required: true }],
  }));
  const inactiveResult = await confirmValidCredentials(inactive.client, { accountId });
  assert.equal(inactiveResult.status, "credentials_inactive");
  assert.equal(inactive.rows.account_credentials[0].reauth_required, true);
});

test("confirm valid refuses cancelled archived or trashed accounts", async () => {
  for (const status of ["cancelled", "archived", "trashed"]) {
    const supabase = makeSupabase(baseRows({
      ig_accounts: [{ id: accountId, status, admin_lifecycle_status: status }],
    }));
    const result = await confirmValidCredentials(supabase.client, { accountId });
    assert.equal(result.status, "account_lifecycle_blocked");
    assert.equal(supabase.rows.account_credentials[0].reauth_required, true);
  }
});

test("after confirm valid readiness now advances past credentials reauth", async () => {
  const supabase = makeSupabase();

  const before = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });
  assert.equal(before.reason, "credentials_reauth_required");

  await confirmValidCredentials(supabase.client, { accountId });
  const after = await runReadinessNow(supabase.client, { accountId, now: new Date("2026-06-09T08:01:00.000Z") });

  assert.notEqual(after.reason, "credentials_reauth_required");
  assert.equal(after.readiness_status, "checking_connection");
  assert.equal(after.preflight_request_created, true);
  assert.equal(supabase.rpcCalls.length, 1);
  assert.equal(supabase.rpcCalls[0].name, "create_account_run_request");
  assert.equal(supabase.rpcCalls[0].args.p_requested_run_type, "login_provisioning");
});

test("confirm valid does not require stale dashboard actions", async () => {
  const supabase = makeSupabase(baseRows({
    account_dashboard_actions: [],
  }));

  const result = await confirmValidCredentials(supabase.client, { accountId });

  assert.equal(result.status, "confirmed");
  assert.equal(supabase.rows.account_credentials[0].reauth_required, false);
});
