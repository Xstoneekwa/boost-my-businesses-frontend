import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATOR_STOP_OPERATOR_LABEL,
  OPERATOR_STOP_SUPPRESSED_REASON,
  operatorStopRunControlProjection,
  shouldBlockAutomaticRestartForOperatorStop,
} from "./operator-stop-suppression.ts";

test("shouldBlockAutomaticRestartForOperatorStop blocks scheduler and auto only", () => {
  const suppression = {
    id: "sup-1",
    account_id: "acct-1",
    assignment_id: null,
    scheduled_window_start: "2026-07-08T10:00:00.000Z",
    scheduled_window_end: "2026-07-08T16:00:00.000Z",
    request_id: null,
    run_id: null,
    status: "active" as const,
    reason_code: OPERATOR_STOP_SUPPRESSED_REASON,
    suppressed_at: "2026-07-08T12:00:00.000Z",
    expires_at: "2026-07-08T16:00:00.000Z",
    metadata_safe: {},
  };
  assert.equal(shouldBlockAutomaticRestartForOperatorStop("scheduler", suppression), true);
  assert.equal(shouldBlockAutomaticRestartForOperatorStop("auto", suppression), true);
  assert.equal(shouldBlockAutomaticRestartForOperatorStop("manual", suppression), false);
  assert.equal(shouldBlockAutomaticRestartForOperatorStop("scheduler", null), false);
});

test("operatorStopRunControlProjection exposes stopping and manual restart labels", () => {
  const stopping = operatorStopRunControlProjection({
    cleanup: {
      inProgress: true,
      phase: "stopping",
      requestId: "req-1",
      runId: "run-1",
      cancelRequestedAt: "2026-07-08T12:00:00.000Z",
    },
    suppression: null,
  });
  assert.equal(stopping.runControlLabel, "Stopping…");
  assert.equal(stopping.eligibilityReason, "stop_cleanup_in_progress");

  const manualOnly = operatorStopRunControlProjection({
    cleanup: {
      inProgress: false,
      phase: "idle",
      requestId: null,
      runId: null,
      cancelRequestedAt: null,
    },
    suppression: {
      id: "sup-1",
      account_id: "acct-1",
      assignment_id: null,
      scheduled_window_start: "2026-07-08T10:00:00.000Z",
      scheduled_window_end: "2026-07-08T16:00:00.000Z",
      request_id: "req-1",
      run_id: "run-1",
      status: "active",
      reason_code: OPERATOR_STOP_SUPPRESSED_REASON,
      suppressed_at: "2026-07-08T12:00:00.000Z",
      expires_at: "2026-07-08T16:00:00.000Z",
      metadata_safe: {},
    },
  });
  assert.equal(manualOnly.runControlLabel, OPERATOR_STOP_OPERATOR_LABEL);
  assert.equal(manualOnly.operatorStopSuppressed, true);
  assert.equal("eligibility" in manualOnly, false);
});
