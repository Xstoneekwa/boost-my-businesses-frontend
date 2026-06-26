import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildLoginEmailCodeResumeMetadata,
  createLoginEmailCodeResumeRunRequest,
  isActiveResumeRequestStatus,
  releaseActiveLoginProvisioningForEmailCodeResume,
} from "./run-control.ts";

/** @typedef {Record<string, unknown>} Row */

const accountId = "871c5836-0fb4-4afb-a5c7-b8bb3fc6b74c";
const actionId = "b57e2b13-2e0b-420c-ab86-15f2a3c074e2";
const submissionId = "7bc4b251-9976-4b6a-b804-08b3fbf8f788";
const parentRequestId = "4dad9d52-905a-4290-b46f-c68c6b31e1aa";
const connectAttemptId = "93439670-df98-4360-9c21-5266df192263";

function makeStatefulSupabase(initial) {
  const requests = [...(initial.requests ?? [])];
  const actions = [...(initial.actions ?? [])];
  const submissions = [...(initial.submissions ?? [])];
  const igRuns = [...(initial.igRuns ?? [])];
  const rpcCalls = [];

  function filterRows(rows, filters) {
    return rows.filter((row) => filters.every((filter) => filter(row)));
  }

  function makeQuery(rows) {
    const filters = [];
    let maxRows = rows.length;
    const updates = [];

    const applyUpdates = () => {
      for (const update of updates) {
        for (const row of rows) {
          if (update.filters.every((filter) => filter(row))) {
            Object.assign(row, update.patch);
          }
        }
      }
      updates.length = 0;
    };

    const buildResult = () => {
      applyUpdates();
      return filterRows(rows, filters).slice(0, maxRows);
    };

    const query = {
      select: () => query,
      eq: (field, value) => {
        filters.push((row) => row[field] === value);
        return query;
      },
      in: (field, values) => {
        filters.push((row) => values.includes(row[field]));
        return query;
      },
      order: () => query,
      limit: (limit) => {
        maxRows = limit;
        return {
          maybeSingle: async () => ({ data: buildResult()[0] ?? null, error: null }),
          then: (resolve) => Promise.resolve({ data: buildResult(), error: null }).then(resolve),
        };
      },
      maybeSingle: async () => ({ data: buildResult()[0] ?? null, error: null }),
      update: (patch) => {
        const updateChain = {
          eq: (field, value) => ({
            in: (statusField, statuses) => {
              updates.push({
                filters: [
                  (row) => row[field] === value,
                  (row) => statuses.includes(row[statusField]),
                ],
                patch,
              });
              return Promise.resolve({ data: buildResult(), error: null });
            },
            eq: (field2, value2) => ({
              eq: (field3, value3) => {
                updates.push({
                  filters: [
                    (row) => row[field] === value,
                    (row) => row[field2] === value2,
                    (row) => row[field3] === value3,
                  ],
                  patch,
                });
                return Promise.resolve({ data: buildResult(), error: null });
              },
            }),
            then: (resolve) => {
              updates.push({
                filters: [(row) => row[field] === value],
                patch,
              });
              return Promise.resolve({ data: buildResult(), error: null }).then(resolve);
            },
          }),
        };
        return updateChain;
      },
      then: (resolve) => Promise.resolve({ data: buildResult(), error: null }).then(resolve),
    };
    return query;
  }

  const client = {
    rpcCalls,
    from(table) {
      if (table === "account_run_requests") return makeQuery(requests);
      if (table === "account_dashboard_actions") return makeQuery(actions);
      if (table === "account_verification_code_submissions") return makeQuery(submissions);
      if (table === "ig_runs") return makeQuery(igRuns);
      return makeQuery([]);
    },
    rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "cancel_account_run_request") {
        const requestId = String(args.p_request_id || "");
        const row = requests.find((entry) => entry.id === requestId);
        if (row) {
          row.status = "canceled";
          row.canceled_at = new Date().toISOString();
        }
        return Promise.resolve({ data: row ?? null, error: null });
      }
      if (name === "create_account_run_request") {
        const active = requests.find((entry) => (
          entry.account_id === args.p_account_id
          && ["queued", "claimed", "starting", "running"].includes(String(entry.status))
        ));
        if (active) {
          return Promise.resolve({ data: null, error: { message: "account_run_already_requested" } });
        }
        const metadata = args.p_metadata_safe && typeof args.p_metadata_safe === "object"
          ? args.p_metadata_safe
          : {};
        const resumeActionId = String(metadata.action_id || metadata.verification_action_id || "");
        if (String(args.p_requested_run_type) === "login_email_code_resume" && !resumeActionId) {
          return Promise.resolve({ data: null, error: { message: "login_resume_action_id_required" } });
        }
        const row = {
          id: `resume-${requests.length + 1}`,
          account_id: args.p_account_id,
          status: "queued",
          requested_run_type: args.p_requested_run_type,
          idempotency_key: args.p_idempotency_key,
          metadata_safe: metadata,
        };
        requests.push(row);
        return Promise.resolve({ data: row, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };

  return { client, requests, actions, submissions, igRuns, rpcCalls };
}

test("resume metadata always includes required action_id", () => {
  const metadata = buildLoginEmailCodeResumeMetadata({
    actionId,
    accountId,
    submissionId,
    parentRequestId,
    connectAttemptId,
  });
  assert.equal(metadata.action_id, actionId);
  assert.equal(metadata.submission_id, submissionId);
  assert.equal(metadata.parent_request_id, parentRequestId);
  assert.equal(metadata.connect_attempt_id, connectAttemptId);
});

test("isActiveResumeRequestStatus accepts queued lifecycle states", () => {
  assert.equal(isActiveResumeRequestStatus("queued"), true);
  assert.equal(isActiveResumeRequestStatus("running"), true);
  assert.equal(isActiveResumeRequestStatus("failed"), false);
});

test("valid code path releases parent provisioning then queues one resume", async () => {
  const supabase = makeStatefulSupabase({
    requests: [{
      id: parentRequestId,
      account_id: accountId,
      status: "running",
      requested_run_type: "login_provisioning",
      run_id: "f72d1559-3ae0-4fb1-91c7-f6f0916a1b75",
      metadata_safe: { connect_attempt_id: connectAttemptId },
    }],
    igRuns: [{
      id: "f72d1559-3ae0-4fb1-91c7-f6f0916a1b75",
      status: "running",
    }],
  });

  const result = await createLoginEmailCodeResumeRunRequest({
    accountId,
    actionId,
    submissionId,
    actorId: "actor-1",
    supabase: supabase.client,
  });

  assert.equal(result.queued, true);
  assert.equal(result.idempotent, false);
  assert.ok(result.requestId);
  assert.equal(result.requestStatus, "queued");
  const resumeCreates = supabase.rpcCalls.filter((call) => call.name === "create_account_run_request");
  assert.equal(resumeCreates.length, 1);
  assert.equal(resumeCreates[0]?.args.p_requested_run_type, "login_email_code_resume");
  assert.equal(resumeCreates[0]?.args.p_metadata_safe.action_id, actionId);
  assert.equal(supabase.requests.filter((row) => row.requested_run_type === "login_email_code_resume").length, 1);
  assert.equal(supabase.requests.find((row) => row.id === parentRequestId)?.status, "canceled");
});

test("duplicate resume enqueue is idempotent", async () => {
  const supabase = makeStatefulSupabase({
    requests: [{
      id: "resume-existing",
      account_id: accountId,
      status: "queued",
      requested_run_type: "login_email_code_resume",
      idempotency_key: `login_email_code_resume:${actionId}:${submissionId}`,
      metadata_safe: { action_id: actionId, submission_id: submissionId },
    }],
  });

  const first = await createLoginEmailCodeResumeRunRequest({
    accountId,
    actionId,
    submissionId,
    supabase: supabase.client,
  });
  const second = await createLoginEmailCodeResumeRunRequest({
    accountId,
    actionId,
    submissionId,
    supabase: supabase.client,
  });

  assert.equal(first.idempotent, true);
  assert.equal(second.idempotent, true);
  assert.equal(first.requestId, "resume-existing");
  assert.equal(second.requestId, "resume-existing");
  assert.equal(supabase.rpcCalls.filter((call) => call.name === "create_account_run_request").length, 0);
});

test("parent active during resume creation is released before enqueue", async () => {
  const supabase = makeStatefulSupabase({
    requests: [{
      id: parentRequestId,
      account_id: accountId,
      status: "running",
      requested_run_type: "login_provisioning",
      run_id: null,
      metadata_safe: { connect_attempt_id: connectAttemptId },
    }],
  });

  const result = await createLoginEmailCodeResumeRunRequest({
    accountId,
    actionId,
    submissionId,
    supabase: supabase.client,
  });

  assert.equal(result.queued, true);
  assert.equal(supabase.requests.find((row) => row.id === parentRequestId)?.status, "canceled");
  assert.equal(supabase.requests.some((row) => row.requested_run_type === "login_email_code_resume"), true);
});

test("resume creation failure after parent handoff returns recoverable reason", async () => {
  const supabase = makeStatefulSupabase({
    requests: [{
      id: parentRequestId,
      account_id: accountId,
      status: "running",
      requested_run_type: "login_provisioning",
      metadata_safe: { connect_attempt_id: connectAttemptId },
    }],
  });

  const originalRpc = supabase.client.rpc.bind(supabase.client);
  supabase.client.rpc = (name, args) => {
    if (name === "cancel_account_run_request") {
      return Promise.resolve({
        data: { id: args.p_request_id, status: "running" },
        error: null,
      });
    }
    if (name === "create_account_run_request") {
      return Promise.resolve({ data: null, error: { message: "account_run_already_requested" } });
    }
    return originalRpc(name, args);
  };

  const result = await createLoginEmailCodeResumeRunRequest({
    accountId,
    actionId,
    submissionId,
    supabase: supabase.client,
  });

  assert.equal(result.queued, false);
  assert.equal(result.requestId, null);
  assert.match(String(result.reason), /parent_handoff_failed|parent_still_active|parent_cancel_failed|resume_queue_failed|account_run_already_requested/);
  assert.equal(supabase.requests.some((row) => row.requested_run_type === "login_email_code_resume"), false);
});

test("queued resume request is claimable by dispatcher semantics", () => {
  const runControlSource = readFileSync(new URL("./run-control.ts", import.meta.url), "utf8");
  assert.match(runControlSource, /ACTIVE_RESUME_REQUEST_STATUSES/);
  assert.match(runControlSource, /claimed/);
  assert.equal(isActiveResumeRequestStatus("claimed"), true);
});

test("admin and BotApp routes delegate to canonical submit service", () => {
  const adminRoute = readFileSync(
    new URL("../../app/api/instagram-dashboard/dashboard-actions/submit-verification-code/route.ts", import.meta.url),
    "utf8",
  );
  const submitService = readFileSync(new URL("./submit-verification-code-service.ts", import.meta.url), "utf8");
  const autoLoginTest = readFileSync(
    new URL("../../app/instagram-dashboard/auto-login-challenge-flow.test.mjs", import.meta.url),
    "utf8",
  );
  assert.match(adminRoute, /submitAccountVerificationCode/);
  assert.match(submitService, /createLoginEmailCodeResumeRunRequest/);
  assert.match(autoLoginTest, /submit-verification-code/);
});

test("check readiness client route stays passive", () => {
  const readinessRoute = readFileSync(
    new URL("../../app/api/instagram-client/accounts/[accountId]/check-readiness/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(readinessRoute, /checkClientAccountReadiness/);
  assert.doesNotMatch(readinessRoute, /create_account_run_request|enqueueClientConnectRequest/);
});

test("client submit route never returns opaque 503 after service persistence", () => {
  const route = readFileSync(
    new URL("../../app/api/instagram-client/accounts/[accountId]/connect/submit-verification-code/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(route, /status:\s*503/);
  assert.match(route, /resume_active/);
  assert.match(route, /client_submit_verification_code_failed/);
});

test("submit service keeps persisted code recoverable without throwing on resume failure", () => {
  const submitService = readFileSync(new URL("./submit-verification-code-service.ts", import.meta.url), "utf8");
  assert.match(submitService, /enqueueVerificationResume/);
  assert.match(submitService, /code_persisted:\s*true/);
  assert.match(submitService, /resume_active/);
  assert.match(submitService, /readExistingSubmissionId/);
  assert.doesNotMatch(submitService, /throw new Error/);
});
