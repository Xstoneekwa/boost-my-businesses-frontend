import assert from "node:assert/strict";
import test from "node:test";

import { canonicalManualStopContinuationAuthorized } from "./auto-restart-manual-stop-continuation.ts";
import { buildAutoRestartResumePlanMetadata } from "./auto-restart-resume-metadata.ts";

const canonical = {
  runId: "run-1",
  runAccountId: "account-1",
  runStatus: "stopped",
  requestId: "request-1",
  requestRunId: "run-1",
  requestAccountId: "account-1",
  requestStatus: "canceled",
  cancelRequestedAt: "2026-08-15T17:44:39.970606Z",
  cancelReason: "botapp_manual_stop",
  attemptId: 2,
  restartAllowed: null,
  restartBlockReason: "resume_plan_missing",
  unsafeMarkers: [] as string[],
};

test("an exact BotApp manual stop is eligible for fresh-boundary continuation", () => {
  assert.equal(canonicalManualStopContinuationAuthorized(canonical), true);
});

test("manual-stop continuation fails closed on lineage, status, reason, or safety drift", () => {
  const mutations = [
    { requestRunId: "other-run" },
    { requestAccountId: "other-account" },
    { runStatus: "failed" },
    { requestStatus: "completed" },
    { cancelRequestedAt: "" },
    { cancelReason: "worker_crash" },
    { attemptId: 0 },
    { restartAllowed: false },
    { restartBlockReason: "challenge_blocked" },
    { unsafeMarkers: ["account_mismatch"] },
  ];

  for (const mutation of mutations) {
    assert.equal(
      canonicalManualStopContinuationAuthorized({ ...canonical, ...mutation }),
      false,
      JSON.stringify(mutation),
    );
  }
});

function candidate(operatorStopContinuation: boolean) {
  return {
    reliability: {
      lastRunId: "run-1",
      sessionTerminationClass: "partial_safe_stopped",
      restartBlockReason: operatorStopContinuation ? "operator_canceled" : "",
      restartAllowed: true,
      operatorStopContinuation,
      operatorStopReason: operatorStopContinuation ? "botapp_manual_stop" : "",
      sourceRequestId: operatorStopContinuation ? "request-1" : "",
    },
    quotas: {
      follow: { remaining: 3, enabled: true },
      unfollow: { remaining: 2, enabled: true },
      welcome: { remaining: 0, enabled: false },
      outreach: { remaining: 0, enabled: false },
    },
  } as never;
}

test("manual Stop metadata forces a fresh boundary and carries exact source lineage", () => {
  const metadata = buildAutoRestartResumePlanMetadata(candidate(true));
  assert.equal(metadata.operator_stop_continuation, true);
  assert.equal(metadata.operator_stop_source_reason, "botapp_manual_stop");
  assert.equal(metadata.source_request_id, "request-1");
  assert.equal(metadata.fresh_boundary_only, true);
  assert.equal(metadata.exact_viewport_resume_available, false);
  assert.equal(metadata.resume_plan.operator_stop_continuation, true);
});

test("ordinary resume metadata remains unchanged by the manual Stop contract", () => {
  const metadata = buildAutoRestartResumePlanMetadata(candidate(false));
  assert.equal("operator_stop_continuation" in metadata, false);
  assert.equal("fresh_boundary_only" in metadata, false);
  assert.equal("exact_viewport_resume_available" in metadata, false);
});
