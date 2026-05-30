import assert from "node:assert/strict";
import test from "node:test";
import { readApiResponse, runStartSuccessMessage } from "./InstagramDashboardButtons";
import { runStartSuccessPayload } from "../api/instagram-dashboard/runs/start/route";
import {
  accountSessionBlockedByWelcomeRealSendDisabled,
  evaluateMiniRunCapsPreflight,
  outreachSessionBlockedByOutreachRealSendDisabled,
  runControlOutreachRealSendEnabled,
  runControlWelcomeRealSendEnabled,
  runStartBlockMessage,
} from "../../lib/instagram-dashboard/run-control";

test("run start 401 is surfaced as an error", async () => {
  await assert.rejects(
    readApiResponse(
      new Response(JSON.stringify({ ok: false, error: "Authentication required." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      "Could not start the run.",
    ),
    /Authentication required/,
  );
});

test("run start success without request_id is rejected by UI", () => {
  assert.throws(
    () => runStartSuccessMessage({ started: true, message: "Manual run request noted.", status: "queued" }),
    /request id/,
  );
});

test("run start success with request_id is shown as success", () => {
  const message = runStartSuccessMessage({
    started: true,
    request_id: "00000000-0000-4000-8000-000000000123",
    status: "queued",
  });
  assert.equal(message, "Run request 00000000 queued (queued).");
});

test("API start success payload includes request id and account id", () => {
  const payload = runStartSuccessPayload({
    accountId: "00000000-0000-4000-8000-000000000001",
    requestId: "00000000-0000-4000-8000-000000000002",
    requestStatus: "queued",
    requestedRunType: "account_session",
  });
  assert.equal(payload.started, true);
  assert.equal(payload.request_id, "00000000-0000-4000-8000-000000000002");
  assert.equal(payload.account_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(payload.status, "queued");
});

test("API idempotent start payload returns existing request id", () => {
  const payload = runStartSuccessPayload({
    accountId: "00000000-0000-4000-8000-000000000001",
    requestId: "00000000-0000-4000-8000-000000000003",
    requestStatus: "claimed",
    requestedRunType: "account_session",
    idempotent: true,
  });
  assert.equal(payload.started, false);
  assert.equal(payload.idempotent, true);
  assert.equal(payload.request_id, "00000000-0000-4000-8000-000000000003");
});

test("account_session is blocked when Welcome requires disabled real send", () => {
  assert.equal(
    accountSessionBlockedByWelcomeRealSendDisabled({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: false,
    }),
    true,
  );
  assert.equal(
    accountSessionBlockedByWelcomeRealSendDisabled({
      requestedRunType: "outreach_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: false,
    }),
    false,
  );
  assert.match(runStartBlockMessage("welcome_real_send_disabled"), /Welcome DM real send is disabled/);
});

test("domain real-send flags isolate Welcome from Outreach and legacy global", () => {
  const env = {
    WELCOME_DM_REAL_SEND_ENABLED: "true",
    OUTREACH_DM_REAL_SEND_ENABLED: "false",
    DM_SENDER_REAL_SEND_ENABLED: "true",
  };

  assert.equal(runControlWelcomeRealSendEnabled(env), true);
  assert.equal(runControlOutreachRealSendEnabled(env), false);
  assert.equal(
    accountSessionBlockedByWelcomeRealSendDisabled({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: runControlWelcomeRealSendEnabled(env),
    }),
    false,
  );
  assert.equal(
    outreachSessionBlockedByOutreachRealSendDisabled({
      requestedRunType: "outreach_session",
      outreachEnabled: true,
      outreachRealSendEnabled: runControlOutreachRealSendEnabled(env),
    }),
    true,
  );
  assert.match(runStartBlockMessage("outreach_real_send_disabled"), /Outreach DM real send is disabled/);
});

test("mini-run preflight blocks when Welcome cap is not proven to be one", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: false,
      outreachEnabled: false,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        FOLLOW_MAX_PER_RUN: "1",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session",
      },
    }),
    "mini_run_welcome_cap_unproven",
  );
});

test("mini-run preflight blocks when Follow caps are not proven to be one", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: false,
      outreachEnabled: false,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        WELCOME_SESSION_SEND_MAX_JOBS: "1",
        FOLLOW_MAX_PER_RUN: "2",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session",
      },
    }),
    "mini_run_follow_cap_unproven",
  );
});

test("mini-run preflight blocks when Outreach isolation is not proven", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: true,
      outreachEnabled: true,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        WELCOME_SESSION_SEND_MAX_JOBS: "1",
        FOLLOW_MAX_PER_RUN: "1",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session,outreach_session",
      },
    }),
    "mini_run_outreach_off_unproven",
  );
});

test("mini-run preflight allows account session when Outreach real send is off", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: false,
      outreachEnabled: true,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        WELCOME_SESSION_SEND_MAX_JOBS: "1",
        FOLLOW_MAX_PER_RUN: "1",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session,outreach_session",
      },
    }),
    null,
  );
});

test("mini-run preflight allows capped account session with dispatcher isolated", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: true,
      outreachEnabled: true,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        WELCOME_SESSION_SEND_MAX_JOBS: "1",
        FOLLOW_MAX_PER_RUN: "1",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session",
      },
    }),
    null,
  );
});
