import assert from "node:assert/strict";
import test from "node:test";
import { readApiResponse, runStartSuccessMessage } from "./InstagramDashboardButtons";
import { runStartSuccessPayload } from "../api/instagram-dashboard/runs/start/route";
import {
  accountSessionBlockedByWelcomeRealSendDisabled,
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
