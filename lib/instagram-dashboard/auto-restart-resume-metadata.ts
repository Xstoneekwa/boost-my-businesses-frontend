import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";

export function buildAutoRestartResumePlanMetadata(candidate: AutoRestartCandidate, now = new Date()) {
  const reliability = candidate.reliability;
  const retryIndex = candidate.nextRetryIndex;
  const attemptId = retryIndex + 1;
  return {
    resume_plan_version: 1,
    resume_plan_schema: "AUTO_RESTART_RESUME_PLAN_V1",
    prior_run_id: candidate.sourceRunId || null,
    session_termination_class: reliability.sessionTerminationClass || null,
    restart_block_reason: reliability.restartBlockReason || null,
    business_session_id: candidate.sourceBusinessSessionId || null,
    attempt_id: attemptId,
    retry_index: retryIndex,
    previous_run_id: candidate.sourceRunId || null,
    root_failure_code: reliability.rootFailureCode || null,
    failure_signature: reliability.failureSignature || null,
    failure_category: reliability.failureCategory || null,
    scheduled_at: now.toISOString(),
    business_day_sast: reliability.businessDaySast || null,
    account_eligible: candidate.accountEligible,
    restart_needed: candidate.restartNeeded,
    exact_viewport_resume_available: candidate.exactViewportResumeAvailable,
    safe_restart_strategy: candidate.safeRestartStrategy,
    safe_restart_reason: candidate.safeRestartReason,
    historical_safe_boundary_fallback: candidate.historicalSafeBoundaryFallback,
    prior_target_id: candidate.priorTargetId,
    next_target_id: candidate.nextTargetId,
    remaining_follow_quota: candidate.remainingFollowQuota,
    resume_plan: {
      schema: "AUTO_RESTART_RESUME_PLAN_V1",
      restart_allowed: candidate.enqueueAllowed,
      restart_block_reason: candidate.enqueueAllowed ? "" : reliability.restartBlockReason || "",
      session_termination_class: reliability.sessionTerminationClass || "",
      business_session_id: candidate.sourceBusinessSessionId || null,
      attempt_id: Number.isFinite(Number(reliability.attemptId)) ? Number(reliability.attemptId) : Math.max(1, retryIndex),
      retry_index: Number.isFinite(Number(reliability.retryIndex)) ? Number(reliability.retryIndex) : Math.max(0, retryIndex - 1),
      next_retry_index: retryIndex,
      previous_run_id: reliability.previousRunId || null,
      root_failure_code: reliability.rootFailureCode || null,
      failure_signature: reliability.failureSignature || null,
      failure_category: reliability.failureCategory || null,
      cleanup_completed: reliability.cleanupCompleted === true,
      lock_released: reliability.lockReleased === true,
      business_day_sast: reliability.businessDaySast || null,
      exact_viewport_resume_available: candidate.exactViewportResumeAvailable,
      safe_restart_strategy: candidate.safeRestartStrategy,
      safe_restart_reason: candidate.safeRestartReason,
      historical_safe_boundary_fallback: candidate.historicalSafeBoundaryFallback,
      prior_target_id: candidate.priorTargetId,
      next_target_id: candidate.nextTargetId,
      phases_to_run: inferPhasesToRun(candidate),
      quota_remaining: {
        follow: candidate.quotas.follow.remaining,
        unfollow: candidate.quotas.unfollow.remaining,
        welcome: candidate.quotas.welcome.remaining,
        outreach: candidate.quotas.outreach.remaining,
      },
      prior_run_id: candidate.sourceRunId || null,
      resume_plan_version: 1,
    },
  };
}

function inferPhasesToRun(candidate: AutoRestartCandidate) {
  const persisted = candidate.reliability.phasesToRun;
  return {
    welcome: persisted
      ? persisted.welcome && candidate.quotas.welcome.remaining > 0 && candidate.quotas.welcome.enabled
      : candidate.quotas.welcome.remaining > 0 && candidate.quotas.welcome.enabled,
    follow: persisted
      ? persisted.follow && candidate.quotas.follow.remaining > 0 && candidate.quotas.follow.enabled
      : candidate.quotas.follow.remaining > 0 && candidate.quotas.follow.enabled,
    unfollow: persisted
      ? persisted.unfollow && candidate.quotas.unfollow.remaining > 0 && candidate.quotas.unfollow.enabled
      : candidate.quotas.unfollow.remaining > 0 && candidate.quotas.unfollow.enabled,
  };
}
