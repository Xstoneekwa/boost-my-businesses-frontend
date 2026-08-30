import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalOperatorStopContinuationAuthorized,
  exactViewportResumeEvidence,
  resolveAccountRestartEligibility,
  resolveAutoRestartDecisionOutcome,
  resolveRestartNeed,
  resolveSafeRestartStrategy,
  sortSafeBoundaryTargets,
} from "./auto-restart-candidate-policy.ts";

test("terminal or exhausted live Unfollow backlog is not-needed, not a blocked incident", () => {
  for (const reason of [
    "unfollow_quota_reached",
    "unfollow_backlog_terminal_only",
    "unfollow_backlog_exhausted",
  ]) {
    assert.equal(resolveAutoRestartDecisionOutcome({
      enqueueAllowed: false,
      decisionReason: reason,
    }), "not_needed");
  }
  assert.equal(resolveAutoRestartDecisionOutcome({
    enqueueAllowed: false,
    decisionReason: "unfollow_backlog_on_cooldown",
  }), "blocked");
});

test("a live Unfollow advisory cannot mask an earlier account safety block", () => {
  assert.deepEqual(resolveAccountRestartEligibility([
    "manual_stop_requested",
    "unfollow_phase_circuit_open",
  ]), {
    eligible: false,
    reason: "manual_stop_requested",
  });
});

test("a hard safety marker outranks an Unfollow circuit or hold advisory", () => {
  assert.deepEqual(resolveAccountRestartEligibility([
    "unfollow_phase_circuit_open",
    "unfollow_backlog_on_cooldown",
    "challenge_blocked",
  ]), {
    eligible: false,
    reason: "challenge_blocked",
  });
});

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
    canonicalLiveUnfollowOverride: false,
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

test("a rejected stale partial is replaced by a fresh business-window admission", () => {
  assert.deepEqual(resolveRestartNeed({
    lastRunId: "old-partial-run",
    sessionTerminationClass: "partial_resumable",
    restartAllowed: false,
    restartBlockReason: "restart_not_needed",
    totalRemainingQuota: 170,
    freshBusinessBoundaryReplacementAuthorized: true,
  }), {
    needed: true,
    reason: "stale_partial_resume_replaced_by_fresh_business_window",
    historicalSafeBoundaryFallback: false,
    canonicalLiveUnfollowOverride: false,
  });
});

test("fresh-window replacement cannot reuse an old exact viewport checkpoint", () => {
  const strategy = resolveSafeRestartStrategy({
    restartNeeded: true,
    followPhasePlanned: true,
    followRemaining: 50,
    exactViewportResumeAvailable: false,
    priorTargetId: "old-target",
    eligibleTargets: [
      { id: "fresh-target", createdAt: "2026-08-31T00:00:00Z", lastUsedAt: null },
    ],
    workerPlanExplicitlySafe: false,
    forceFreshBoundary: true,
  });
  assert.deepEqual(strategy, {
    strategy: "next_target",
    reason: "next_eligible_target_identified",
    nextTargetId: "fresh-target",
  });
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
    followPhasePlanned: true,
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
    followPhasePlanned: true,
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
    followPhasePlanned: true,
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
    followPhasePlanned: true,
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
    followPhasePlanned: true,
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

test("an explicit Unfollow-only plan never requires a CT even when raw Follow quota remains", () => {
  assert.deepEqual(resolveSafeRestartStrategy({
    restartNeeded: true,
    followPhasePlanned: false,
    followRemaining: 30,
    exactViewportResumeAvailable: false,
    priorTargetId: "stale-follow-target",
    eligibleTargets: [],
    workerPlanExplicitlySafe: true,
  }), {
    strategy: "exact_checkpoint_resume",
    reason: "non_follow_phase_resume_plan",
    nextTargetId: null,
  });
});

test("explicit restart_allowed wins over a missing legacy block reason", () => {
  assert.deepEqual(resolveRestartNeed({
    lastRunId: "terminal-partial-run",
    sessionTerminationClass: "partial_resumable",
    restartAllowed: true,
    restartBlockReason: "resume_plan_missing",
    totalRemainingQuota: 3,
  }), {
    needed: true,
    reason: "partial_run_resume_needed",
    historicalSafeBoundaryFallback: false,
    canonicalLiveUnfollowOverride: false,
  });
});

test("canonical live Unfollow backlog overrides a stale restart_not_needed snapshot", () => {
  assert.deepEqual(resolveRestartNeed({
    lastRunId: "loriele-partial-run",
    sessionTerminationClass: "partial_resumable",
    restartAllowed: false,
    restartBlockReason: "restart_not_needed",
    totalRemainingQuota: 3,
    canonicalLiveUnfollowResumeAuthorized: true,
  }), {
    needed: true,
    reason: "partial_live_unfollow_backlog_resume_needed",
    historicalSafeBoundaryFallback: false,
    canonicalLiveUnfollowOverride: true,
  });
});

test("failed mandatory Unfollow backlog overrides only the contradictory session_completed projection", () => {
  assert.deepEqual(resolveRestartNeed({
    lastRunId: "completed-session-failed-unfollow",
    sessionTerminationClass: "completed",
    restartAllowed: false,
    restartBlockReason: "session_completed",
    totalRemainingQuota: 80,
    canonicalLiveUnfollowResumeAuthorized: true,
  }), {
    needed: true,
    reason: "partial_live_unfollow_backlog_resume_needed",
    historicalSafeBoundaryFallback: false,
    canonicalLiveUnfollowOverride: true,
  });
});

test("resolved incident live-plan rebuild authorizes the same exact failed Unfollow continuation", () => {
  assert.deepEqual(resolveRestartNeed({
    lastRunId: "resolved-session-failed-unfollow",
    sessionTerminationClass: "completed",
    restartAllowed: true,
    restartBlockReason: "resolved_incident_live_plan_rebuild",
    totalRemainingQuota: 80,
    canonicalLiveUnfollowResumeAuthorized: true,
  }), {
    needed: true,
    reason: "partial_live_unfollow_backlog_resume_needed",
    historicalSafeBoundaryFallback: false,
    canonicalLiveUnfollowOverride: true,
  });
});

test("canonical live Unfollow backlog never overrides a critical Worker block", () => {
  const result = resolveRestartNeed({
    lastRunId: "run-critical",
    sessionTerminationClass: "partial_resumable",
    restartAllowed: false,
    restartBlockReason: "cleanup_not_completed",
    totalRemainingQuota: 3,
    canonicalLiveUnfollowResumeAuthorized: true,
  });
  assert.equal(result.needed, false);
  assert.equal(result.canonicalLiveUnfollowOverride, false);
  assert.equal(result.reason, "cleanup_not_completed");
});

test("a canonical BotApp stop starts a fresh safe-boundary session when live quota remains", () => {
  assert.deepEqual(resolveRestartNeed({
    lastRunId: "stopped-run",
    sessionTerminationClass: "completed",
    restartAllowed: false,
    restartBlockReason: "operator_canceled",
    totalRemainingQuota: 7,
    operatorStopContinuationAuthorized: true,
  }), {
    needed: true,
    reason: "operator_stopped_safe_boundary_continuation",
    historicalSafeBoundaryFallback: false,
    canonicalLiveUnfollowOverride: false,
  });
});

test("operator-stop continuation ignores an exact viewport and rebuilds a fresh boundary", () => {
  assert.deepEqual(resolveSafeRestartStrategy({
    restartNeeded: true,
    followPhasePlanned: false,
    followRemaining: 0,
    exactViewportResumeAvailable: true,
    priorTargetId: "stale-target",
    eligibleTargets: [],
    workerPlanExplicitlySafe: false,
    forceFreshBoundary: true,
  }), {
    strategy: "rebuilt_safe_target_plan",
    reason: "operator_stop_live_phase_plan_rebuilt",
    nextTargetId: null,
  });
});

test("operator-stop provenance accepts only the exact canonical BotApp cancellation", () => {
  const canonical = {
    sourcePlanLineageValid: true,
    attemptLineageValid: true,
    lastRunStatus: "stopped",
    sourceRequestStatus: "canceled",
    cancelRequestedAt: "2026-08-01T12:00:00.000Z",
    cancelReason: "botapp_manual_stop",
    restartAllowed: false,
    restartBlockReason: "operator_canceled",
    unsafeMarkers: [],
  };
  assert.equal(canonicalOperatorStopContinuationAuthorized(canonical), true);
  for (const mutation of [
    { cancelReason: "operator_stop_hotfix" },
    { cancelRequestedAt: "" },
    { sourceRequestStatus: "running" },
    { lastRunStatus: "completed" },
    { restartBlockReason: "restriction_blocked" },
    { sourcePlanLineageValid: false },
    { attemptLineageValid: false },
  ]) {
    assert.equal(canonicalOperatorStopContinuationAuthorized({ ...canonical, ...mutation }), false);
  }
});

test("an exact request-bound BotApp stop survives a missing run-side resume projection", () => {
  const fallback = {
    sourcePlanLineageValid: false,
    attemptLineageValid: true,
    lastRunStatus: "stopped",
    sourceRequestStatus: "canceled",
    cancelRequestedAt: "2026-08-15T17:44:39.970606Z",
    cancelReason: "botapp_manual_stop",
    restartAllowed: null,
    restartBlockReason: "resume_plan_missing",
    unsafeMarkers: [],
  };
  assert.equal(canonicalOperatorStopContinuationAuthorized(fallback), true);
  assert.equal(canonicalOperatorStopContinuationAuthorized({ ...fallback, attemptLineageValid: false }), false);
  assert.equal(canonicalOperatorStopContinuationAuthorized({ ...fallback, unsafeMarkers: ["challenge_blocked"] }), false);
  assert.equal(canonicalOperatorStopContinuationAuthorized({ ...fallback, restartAllowed: false }), false);
  assert.equal(canonicalOperatorStopContinuationAuthorized({ ...fallback, restartBlockReason: "cleanup_not_completed" }), false);
});
