import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";

export function buildAutoRestartResumePlanMetadata(candidate: AutoRestartCandidate, now = new Date()) {
  const reliability = candidate.reliability;
  const retryIndex = Number.parseInt(reliability.nextRetryIndex, 10);
  const attemptId = retryIndex + 1;
  return {
    resume_plan_version: 1,
    resume_plan_schema: "AUTO_RESTART_RESUME_PLAN_V1",
    prior_run_id: reliability.lastRunId || null,
    session_termination_class: reliability.sessionTerminationClass || null,
    restart_block_reason: reliability.restartBlockReason || null,
    business_session_id: reliability.businessSessionId || null,
    attempt_id: attemptId,
    retry_index: retryIndex,
    previous_run_id: reliability.lastRunId || null,
    root_failure_code: reliability.rootFailureCode || null,
    failure_signature: reliability.failureSignature || null,
    failure_category: reliability.failureCategory || null,
    scheduled_at: now.toISOString(),
    business_day_sast: reliability.businessDaySast || null,
    resume_plan: {
      schema: "AUTO_RESTART_RESUME_PLAN_V1",
      restart_allowed: reliability.restartAllowed === true,
      restart_block_reason: reliability.restartBlockReason || "",
      session_termination_class: reliability.sessionTerminationClass || "",
      business_session_id: reliability.businessSessionId || null,
      attempt_id: reliability.attemptId,
      retry_index: reliability.retryIndex,
      next_retry_index: reliability.nextRetryIndex,
      previous_run_id: reliability.previousRunId || null,
      root_failure_code: reliability.rootFailureCode || null,
      failure_signature: reliability.failureSignature || null,
      failure_category: reliability.failureCategory || null,
      cleanup_completed: reliability.cleanupCompleted === true,
      lock_released: reliability.lockReleased === true,
      business_day_sast: reliability.businessDaySast || null,
      phases_to_run: inferPhasesToRun(candidate),
      quota_remaining: {
        follow: candidate.quotas.follow.remaining,
        unfollow: candidate.quotas.unfollow.remaining,
        welcome: candidate.quotas.welcome.remaining,
        outreach: candidate.quotas.outreach.remaining,
      },
      prior_run_id: reliability.lastRunId || null,
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
