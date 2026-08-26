export type SafeRestartStrategy =
  | "exact_checkpoint_resume"
  | "next_target"
  | "same_target_from_top_with_dedup"
  | "rebuilt_safe_target_plan"
  | "none";

export type SafeBoundaryTarget = {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type RestartNeedInput = {
  lastRunId: string;
  sessionTerminationClass: string;
  restartAllowed: boolean | null;
  restartBlockReason: string;
  totalRemainingQuota: number;
  canonicalLiveUnfollowResumeAuthorized?: boolean;
  operatorStopContinuationAuthorized?: boolean;
};

export type SafeRestartStrategyInput = {
  restartNeeded: boolean;
  followPhasePlanned: boolean;
  followRemaining: number;
  exactViewportResumeAvailable: boolean;
  priorTargetId: string | null;
  eligibleTargets: SafeBoundaryTarget[];
  workerPlanExplicitlySafe: boolean;
  forceFreshBoundary?: boolean;
};

const HISTORICAL_SAFE_BOUNDARY_FALLBACK_REASONS = new Set([
  "resume_plan_missing",
  "unsafe_follow_resume_checkpoint",
]);

function normalized(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function canonicalOperatorStopContinuationAuthorized(input: {
  sourcePlanLineageValid: boolean;
  attemptLineageValid: boolean;
  lastRunStatus: string;
  sourceRequestStatus: string;
  cancelRequestedAt: string;
  cancelReason: string;
  restartAllowed: boolean | null;
  restartBlockReason: string;
  unsafeMarkers: string[];
}) {
  const blockReason = normalized(input.restartBlockReason);
  const missingRunPlanFallback = !input.sourcePlanLineageValid
    && input.restartAllowed === null
    && blockReason === "resume_plan_missing"
    && input.unsafeMarkers.length === 0;
  const canonicalRunPlan = input.sourcePlanLineageValid
    && blockReason === "operator_canceled";
  return (canonicalRunPlan || missingRunPlanFallback)
    && input.attemptLineageValid
    && ["stopped", "canceled"].includes(normalized(input.lastRunStatus))
    && normalized(input.sourceRequestStatus) === "canceled"
    && Boolean(input.cancelRequestedAt.trim())
    && normalized(input.cancelReason) === "botapp_manual_stop";
}

export function canonicalSourceLineageValid(input: {
  sourcePlanLineageValid: boolean;
  attemptLineageValid: boolean;
  operatorStopContinuationAuthorized: boolean;
}) {
  return input.attemptLineageValid
    && (
      input.sourcePlanLineageValid
      || input.operatorStopContinuationAuthorized
    );
}

export function isPartialResumeClass(value: string) {
  return ["partial_resumable", "partial_safe_stopped"].includes(normalized(value));
}

export function resolveAccountRestartEligibility(blockingReasons: string[]) {
  const reasons = blockingReasons.map((reason) => reason.trim()).filter(Boolean);
  const hardSafetyReason = reasons.find((reason) =>
    reason === "challenge_blocked"
    || reason === "restriction_blocked"
    || reason === "account_mismatch_blocked"
    || reason === "device_offline_blocked"
    || reason.startsWith("unsafe_markers:"));
  return {
    eligible: reasons.length === 0,
    reason: hardSafetyReason || reasons[0] || "eligible",
  } as const;
}

const AUTO_RESTART_NOT_NEEDED_REASONS = new Set([
  "manual_only",
  "planned_future_window",
  "current_window_closed",
  "active_run_exists",
  "active_run_request_exists",
  "no_partial_run_to_resume",
  "run_in_progress",
  "quota_exhausted",
  "no_quota_remaining",
  "all_enabled_phase_work_completed",
  "unfollow_quota_reached",
  "unfollow_backlog_terminal_only",
  "unfollow_backlog_exhausted",
]);

export function resolveAutoRestartDecisionOutcome(input: {
  enqueueAllowed: boolean;
  decisionReason: string;
}) {
  if (input.enqueueAllowed) return "eligible" as const;
  return AUTO_RESTART_NOT_NEEDED_REASONS.has(input.decisionReason)
    ? "not_needed" as const
    : "blocked" as const;
}

/**
 * Separates the business fact "a partial session still needs work" from the
 * lower-level cursor evidence used to choose where the next run starts.
 * Legacy runs missing a newly introduced viewport checkpoint remain resumable
 * only through a safe business boundary, never through an invented cursor.
 */
export function resolveRestartNeed(input: RestartNeedInput) {
  if (!input.lastRunId) {
    return {
      needed: false,
      reason: "no_partial_run_to_resume",
      historicalSafeBoundaryFallback: false,
      canonicalLiveUnfollowOverride: false,
    } as const;
  }

  if (input.totalRemainingQuota <= 0) {
    return {
      needed: false,
      reason: "quota_exhausted",
      historicalSafeBoundaryFallback: false,
      canonicalLiveUnfollowOverride: false,
    } as const;
  }

  if (input.operatorStopContinuationAuthorized === true) {
    return {
      needed: true,
      reason: "operator_stopped_safe_boundary_continuation",
      historicalSafeBoundaryFallback: false,
      canonicalLiveUnfollowOverride: false,
    } as const;
  }

  const partial = isPartialResumeClass(input.sessionTerminationClass);
  const blockReason = normalized(input.restartBlockReason);
  // The live Unfollow authority is built from the latest request-linked
  // outcome plus the current DB backlog. It may also repair the contradictory
  // projection `session completed + Unfollow failed`, but never a genuinely
  // completed Unfollow phase. Critical safety blocks remain excluded by this
  // narrow allow-list.
  if (
    input.canonicalLiveUnfollowResumeAuthorized === true
    && [
      "restart_not_needed",
      "auto_restart_retries_exhausted",
      "session_completed",
      "resolved_incident_live_plan_rebuild",
      "restart_not_allowed_for_termination_class",
    ].includes(blockReason)
  ) {
    return {
      needed: true,
      reason: "partial_live_unfollow_backlog_resume_needed",
      historicalSafeBoundaryFallback: false,
      canonicalLiveUnfollowOverride: true,
    } as const;
  }
  const historicalSafeBoundaryFallback = input.restartAllowed !== true
    && partial
    && HISTORICAL_SAFE_BOUNDARY_FALLBACK_REASONS.has(blockReason);

  if (partial && input.restartAllowed === true) {
    return {
      needed: true,
      reason: "partial_run_resume_needed",
      historicalSafeBoundaryFallback: false,
      canonicalLiveUnfollowOverride: false,
    } as const;
  }

  if (historicalSafeBoundaryFallback) {
    return {
      needed: true,
      reason: "historical_partial_run_requires_safe_boundary",
      historicalSafeBoundaryFallback: true,
      canonicalLiveUnfollowOverride: false,
    } as const;
  }

  if (blockReason === "run_in_progress") {
    return {
      needed: false,
      reason: "run_in_progress",
      historicalSafeBoundaryFallback: false,
      canonicalLiveUnfollowOverride: false,
    } as const;
  }

  if (["session_completed", "restart_not_needed", "restart_not_allowed_for_termination_class"].includes(blockReason)) {
    return {
      needed: false,
      reason: "no_partial_run_to_resume",
      historicalSafeBoundaryFallback: false,
      canonicalLiveUnfollowOverride: false,
    } as const;
  }

  return {
    needed: false,
    reason: blockReason || "no_partial_run_to_resume",
    historicalSafeBoundaryFallback: false,
    canonicalLiveUnfollowOverride: false,
  } as const;
}

/** Mirrors the Worker source planner: unused CT first, then oldest use. */
export function sortSafeBoundaryTargets(targets: SafeBoundaryTarget[]) {
  return [...targets].sort((left, right) => {
    const leftUsed = left.lastUsedAt ? 1 : 0;
    const rightUsed = right.lastUsedAt ? 1 : 0;
    if (leftUsed !== rightUsed) return leftUsed - rightUsed;
    const usedOrder = String(left.lastUsedAt || "").localeCompare(String(right.lastUsedAt || ""));
    if (usedOrder) return usedOrder;
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    return createdOrder || left.id.localeCompare(right.id);
  });
}

export function resolveSafeRestartStrategy(input: SafeRestartStrategyInput) {
  if (!input.restartNeeded) {
    return {
      strategy: "none" as SafeRestartStrategy,
      reason: "no_partial_run_to_resume",
      nextTargetId: null,
    };
  }

  if (input.forceFreshBoundary && !input.followPhasePlanned) {
    return {
      strategy: "rebuilt_safe_target_plan" as SafeRestartStrategy,
      reason: "operator_stop_live_phase_plan_rebuilt",
      nextTargetId: null,
    };
  }

  if (!input.followPhasePlanned && input.workerPlanExplicitlySafe) {
    return {
      strategy: "exact_checkpoint_resume" as SafeRestartStrategy,
      reason: "non_follow_phase_resume_plan",
      nextTargetId: null,
    };
  }

  if (input.exactViewportResumeAvailable && !input.forceFreshBoundary) {
    return {
      strategy: "exact_checkpoint_resume" as SafeRestartStrategy,
      reason: "certified_exact_checkpoint",
      nextTargetId: input.priorTargetId,
    };
  }

  const orderedTargets = sortSafeBoundaryTargets(input.eligibleTargets);
  const firstTarget = orderedTargets[0];
  if (!firstTarget) {
    return {
      strategy: "none" as SafeRestartStrategy,
      reason: "no_safe_target_plan_available",
      nextTargetId: null,
    };
  }

  if (input.priorTargetId && firstTarget.id !== input.priorTargetId) {
    return {
      strategy: "next_target" as SafeRestartStrategy,
      reason: "next_eligible_target_identified",
      nextTargetId: firstTarget.id,
    };
  }

  if (input.priorTargetId && firstTarget.id === input.priorTargetId) {
    return {
      strategy: "same_target_from_top_with_dedup" as SafeRestartStrategy,
      reason: "same_target_reopened_from_top_with_social_memory",
      nextTargetId: firstTarget.id,
    };
  }

  return {
    strategy: "rebuilt_safe_target_plan" as SafeRestartStrategy,
    reason: "eligible_target_plan_rebuilt_without_historical_cursor",
    nextTargetId: firstTarget.id,
  };
}

export function exactViewportResumeEvidence(input: {
  safeCheckpointAvailable: boolean;
  targetRotationSafeAfterScrollFailure: boolean;
  scrollFailureSurfaceAmbiguous: boolean;
}) {
  return input.safeCheckpointAvailable
    || (
      input.targetRotationSafeAfterScrollFailure
      && !input.scrollFailureSurfaceAmbiguous
    );
}
