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

function makeSupabase() {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table === "account_assignments") {
          return makeQueryResult([
            {
              account_id: "account-needs-login",
              starts_at: "2026-06-09T08:10:00.000Z",
              status: "reserved",
            },
            {
              account_id: "account-connected",
              starts_at: "2026-06-09T08:04:00.000Z",
              status: "reserved",
            },
          ]);
        }
        if (table === "client_instagram_accounts") {
          return makeQueryResult([
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
          ]);
        }
        if (table === "account_run_requests") {
          return makeQueryResult([]);
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
  assert.match(String(supabase.rpcCalls[0].args.p_idempotency_key), /login-preflight:account-needs-login:t10:/);
  assert.equal(supabase.rpcCalls[1].name, "upsert_account_dashboard_action");
});
