import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  clientConnectAttemptIdempotencyKey,
  enqueueClientConnectRequest,
} from "./enqueue-client-connect.ts";
import { projectClientConnectProgress } from "./connect-progress-projection.ts";

type Row = Record<string, unknown>;

const accountId = "account-lucie-1";
const assignmentId = "assignment-1";
const failedRequestId = "e1f23311-edf6-40cb-95ea-3cc0704d97c3";

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

function makeSupabase(requestRows: Row[], rpcError: string | null = null) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table === "account_run_requests") return makeQuery(requestRows);
        return makeQuery([]);
      },
      rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "create_account_run_request") {
          if (rpcError) {
            return Promise.resolve({ data: null, error: { message: rpcError } });
          }
          return Promise.resolve({
            data: {
              id: "request-new-1",
              status: "queued",
              account_id: accountId,
              requested_run_type: "login_provisioning",
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

test("attempt idempotency key includes server attempt uuid", () => {
  const key = clientConnectAttemptIdempotencyKey(assignmentId, "attempt-uuid-1");
  assert.equal(key, "login-preflight-now:assignment-1:attempt-uuid-1");
  assert.notEqual(key, `login-preflight-now:${assignmentId}`);
});

test("terminal failed request does not block new connect enqueue", async () => {
  const supabase = makeSupabase([{
    id: failedRequestId,
    account_id: accountId,
    status: "failed",
    requested_run_type: "login_provisioning",
    idempotency_key: `login-preflight-now:${assignmentId}`,
  }]);
  const result = await enqueueClientConnectRequest(supabase.client, {
    accountId,
    actorId: "actor-1",
    assignmentId,
    deadlineAt: "2026-06-23T12:00:00.000Z",
  });
  assert.equal(result.preflight_request_created, true);
  assert.equal(result.idempotent, false);
  assert.equal(supabase.rpcCalls.length, 1);
  assert.match(String(supabase.rpcCalls[0]?.args.p_idempotency_key), /^login-preflight-now:assignment-1:/);
});

test("active login_provisioning request is reused without second rpc", async () => {
  const supabase = makeSupabase([{
    id: "request-active",
    account_id: accountId,
    status: "running",
    requested_run_type: "login_provisioning",
    idempotency_key: "login-preflight-now:assignment-1:old-attempt",
  }]);
  const result = await enqueueClientConnectRequest(supabase.client, {
    accountId,
    actorId: "actor-1",
    assignmentId,
    deadlineAt: "2026-06-23T12:00:00.000Z",
  });
  assert.equal(result.idempotent, true);
  assert.equal(result.reason, "already_requested");
  assert.equal(result.run_request_status, "running");
  assert.equal(supabase.rpcCalls.length, 0);
});

test("account_run_already_requested race reloads active request", async () => {
  let rpcCount = 0;
  const requestRows: Row[] = [];
  const client = {
    from(table: string) {
      if (table === "account_run_requests") return makeQuery(requestRows);
      return makeQuery([]);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== "create_account_run_request") {
        return Promise.resolve({ data: null, error: null });
      }
      rpcCount += 1;
      if (rpcCount === 1) {
        requestRows.push({
          id: "request-raced",
          account_id: accountId,
          status: "queued",
          requested_run_type: "login_provisioning",
          idempotency_key: String(args.p_idempotency_key),
        });
        return Promise.resolve({ data: null, error: { message: "account_run_already_requested" } });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  const result = await enqueueClientConnectRequest(client, {
    accountId,
    actorId: "actor-1",
    assignmentId,
    deadlineAt: "2026-06-23T12:00:00.000Z",
  });
  assert.equal(result.idempotent, true);
  assert.equal(result.request_id, "request-raced");
});

test("terminal failed request is not shown as active queue progress", () => {
  const projection = projectClientConnectProgress({
    accountId,
    overallStatus: "failed",
    requestStatus: "failed",
    runStatus: "failed",
    requestId: "request-failed",
    reason: "Worker subprocess exited with code 1.",
    steps: [
      { id: "queue_request", label: "Queue request", subtitle: "Received", status: "done" },
    ],
    lang: "fr",
  });
  assert.equal(projection.connect_status, "failed");
  assert.equal(projection.failed, true);
  assert.notEqual(projection.connect_status, "not_created");
});

test("connect-account uses canonical client enqueue service", () => {
  const source = readFileSync(new URL("./connect-account.ts", import.meta.url), "utf8");
  assert.match(source, /enqueueClientConnectRequest/);
  assert.doesNotMatch(source, /mode: CONNECT_ENQUEUE_MODE/);
});

test("progress loader excludes terminal request fallback", () => {
  const source = readFileSync(new URL("./load-client-connect-progress.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /if \(!requestRow && !input\.requestId\)/);
  assert.match(source, /verifyConnectOperationToken/);
  assert.match(source, /loadLoginProvisioningRequestByAttemptId/);
});

test("blocked connect request exposes client-safe security message", () => {
  const projection = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "blocked",
    requestStatus: "blocked",
    reason: "La connexion nécessite une vérification de sécurité avant de pouvoir continuer.",
    lang: "fr",
  });
  assert.equal(projection.connect_status, "blocked");
  assert.equal(
    projection.message,
    "La connexion nécessite une vérification de sécurité avant de pouvoir continuer.",
  );
  assert.equal(projection.verification.required, false);
  assert.equal(projection.action_required, null);
});

test("client modal does not poll progress during submitting", () => {
  const source = readFileSync(
    new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /connectPhase === "submitting"/);
});
