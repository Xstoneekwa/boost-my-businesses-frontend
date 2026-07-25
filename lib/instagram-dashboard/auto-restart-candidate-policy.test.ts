import assert from "node:assert/strict";
import test from "node:test";

import {
  exactViewportResumeEvidence,
  resolveAccountRestartEligibility,
  resolveRestartNeed,
  resolveSafeRestartStrategy,
  sortSafeBoundaryTargets,
} from "./auto-restart-candidate-policy.ts";

test("only current real blockers exclude an otherwise normal account", () => {
  assert.deepEqual(resolveAccountRestartEligibility([]), { eligible: true, reason: "eligible" });
  for (const reason of [
    "current_window_closed",
    "blocking_incident_active",
    "manual_stop_requested",
    "manual_only",
    "no_quota_remaining",
    "active_run_exists",
    "active_run_request_exists",
    "device_lock_held",
  ]) {
    assert.deepEqual(resolveAccountRestartEligibility([reason]), { eligible: false, reason });
  }
});

test("a partial historical run remains needed when only its viewport checkpoint is missing", () => {
  assert.deepEqual(resolveRestartNeed({
    lastRunId: "a00e0582-ebf6-421b-aade-8508760c08d5",
    sessionTerminationClass: "partial_resumable",
    restartAllowed: false,
    restartBlockReason: "unsafe_follow_resume_checkpoint",
    totalRemainingQuota: 23,
  }), {
    needed: true,
    reason: "historical_partial_run_requires_safe_boundary",
    historicalSafeBoundaryFallback: true,
  });
});

test("no partial run means no restart even when the account is otherwise eligible", () => {
  assert.equal(resolveRestartNeed({
    lastRunId: "completed-run",
    sessionTerminationClass: "completed",
    restartAllowed: false,
    restartBlockReason: "session_completed",
    totalRemainingQuota: 23,
  }).needed, false);
});

test("the safe boundary target order mirrors the Worker unused-then-oldest contract", () => {
  assert.deepEqual(sortSafeBoundaryTargets([
    { id: "used-new", createdAt: "2026-07-03", lastUsedAt: "2026-07-24" },
    { id: "unused-second", createdAt: "2026-07-02", lastUsedAt: null },
    { id: "unused-first", createdAt: "2026-07-01", lastUsedAt: null },
    { id: "used-old", createdAt: "2026-07-04", lastUsedAt: "2026-07-23" },
  ]).map((target) => target.id), [
    "unused-first",
    "unused-second",
    "used-old",
    "used-new",
  ]);
});

test("j_automatise resumes at the next unused CT with exactly 23 follows remaining", () => {
  const strategy = resolveSafeRestartStrategy({
    restartNeeded: true,
    followRemaining: 23,
    exactViewportResumeAvailable: false,
    priorTargetId: "0b189dbf-b3da-49ec-a3f5-8fa404d94046",
    eligibleTargets: [
      {
        id: "0b189dbf-b3da-49ec-a3f5-8fa404d94046",
        createdAt: "2026-07-01T00:00:00Z",
        lastUsedAt: "2026-07-25T10:00:00Z",
      },
      {
        id: "5b665051-af0e-4146-ad7e-1bbb5b18d6f8",
        createdAt: "2026-07-02T00:00:00Z",
        lastUsedAt: null,
      },
    ],
    workerPlanExplicitlySafe: true,
  });
  assert.deepEqual(strategy, {
    strategy: "next_target",
    reason: "next_eligible_target_identified",
    nextTargetId: "5b665051-af0e-4146-ad7e-1bbb5b18d6f8",
  });
});

test("when only the prior target remains it restarts from its top with social-memory dedup", () => {
  assert.equal(resolveSafeRestartStrategy({
    restartNeeded: true,
    followRemaining: 23,
    exactViewportResumeAvailable: false,
    priorTargetId: "target-1",
    eligibleTargets: [{ id: "target-1", createdAt: "2026-07-01", lastUsedAt: null }],
    workerPlanExplicitlySafe: true,
  }).strategy, "same_target_from_top_with_dedup");
});

test("without a historical CT it rebuilds a deterministic safe target plan", () => {
  assert.deepEqual(resolveSafeRestartStrategy({
    restartNeeded: true,
    followRemaining: 23,
    exactViewportResumeAvailable: false,
    priorTargetId: null,
    eligibleTargets: [{ id: "target-2", createdAt: "2026-07-02", lastUsedAt: null }],
    workerPlanExplicitlySafe: true,
  }), {
    strategy: "rebuilt_safe_target_plan",
    reason: "eligible_target_plan_rebuilt_without_historical_cursor",
    nextTargetId: "target-2",
  });
});

test("an exact checkpoint is used only when explicit evidence exists", () => {
  assert.equal(exactViewportResumeEvidence({
    safeCheckpointAvailable: false,
    targetRotationSafeAfterScrollFailure: false,
    scrollFailureSurfaceAmbiguous: false,
  }), false);
  assert.equal(resolveSafeRestartStrategy({
    restartNeeded: true,
    followRemaining: 23,
    exactViewportResumeAvailable: true,
    priorTargetId: "target-1",
    eligibleTargets: [],
    workerPlanExplicitlySafe: true,
  }).strategy, "exact_checkpoint_resume");
});

test("no exact checkpoint and no eligible target fails closed", () => {
  assert.deepEqual(resolveSafeRestartStrategy({
    restartNeeded: true,
    followRemaining: 23,
    exactViewportResumeAvailable: false,
    priorTargetId: "target-1",
    eligibleTargets: [],
    workerPlanExplicitlySafe: true,
  }), {
    strategy: "none",
    reason: "no_safe_target_plan_available",
    nextTargetId: null,
  });
});
