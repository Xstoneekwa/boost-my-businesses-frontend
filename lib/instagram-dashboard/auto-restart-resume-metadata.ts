import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";

export function buildAutoRestartResumePlanMetadata(candidate: AutoRestartCandidate, now = new Date()) {
  const reliability = candidate.reliability;
  const retryIndex = candidate.nextRetryIndex;
  const attemptId = retryIndex + 1;
  return {
    resume_plan_version: 2,
    resume_plan_schema: "AUTO_RESTART_RESUME_PLAN_V2",
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
      schema: "AUTO_RESTART_RESUME_PLAN_V2",
      plan_version: 2,
      account_id: candidate.accountId,
      assignment_id: candidate.assignmentId,
      device_id: candidate.deviceId || null,
      app_instance_id: candidate.appInstanceId || null,
      package_id: candidate.packageCode,
      package_label: candidate.packageLabel,
      package_caps: candidate.packageCaps ?? null,
      package_contract_ready: Boolean(candidate.packageCode || candidate.packageLabel),
      warmup_day: candidate.warmupDay,
      warmup_status: candidate.warmupStatus,
      warmup_cap: candidate.quotas.follow.capDay,
      scheduled_window_start: candidate.scheduledWindowStart,
      scheduled_window_end: candidate.scheduledWindowEnd,
      window_id: candidate.assignmentId,
      phase_order: ["welcome", "follow", "unfollow"],
      follow_enabled: candidate.quotas.follow.enabled,
      unfollow_enabled: candidate.quotas.unfollow.enabled,
      outreach_enabled: candidate.quotas.outreach.enabled,
      follow_target: candidate.quotas.follow.plannedNextRunQuota,
      follow_remaining: candidate.quotas.follow.remaining,
      follow_session_override: candidate.followSessionOverride ?? null,
      max_follows_per_target_per_run: candidate.maxFollowsPerTargetPerRun ?? null,
      max_targets_per_run: candidate.maxTargetsPerRun ?? null,
      unfollow_target: candidate.quotas.unfollow.plannedNextRunQuota,
      unfollow_remaining: candidate.quotas.unfollow.remaining,
      outreach_remaining: candidate.quotas.outreach.remaining,
      candidate_counts: {
        follow_targets: candidate.eligibleFollowTargetCount,
        unfollow_candidates: null,
        welcome_candidates: null,
        source: "canonical_backend_candidate_projection",
      },
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
      quota_consumed: {
        follow: candidate.quotas.follow.doneToday,
        unfollow: candidate.quotas.unfollow.doneToday,
        welcome: candidate.quotas.welcome.doneToday,
        outreach: candidate.quotas.outreach.doneToday,
      },
      quota_caps: {
        follow: candidate.quotas.follow.capDay,
        unfollow: candidate.quotas.unfollow.capDay,
        welcome: candidate.quotas.welcome.capDay,
        outreach: candidate.quotas.outreach.capDay,
      },
      quota_remaining: {
        follow: candidate.quotas.follow.remaining,
        unfollow: candidate.quotas.unfollow.remaining,
        welcome: candidate.quotas.welcome.remaining,
        outreach: candidate.quotas.outreach.remaining,
      },
      prior_run_id: candidate.sourceRunId || null,
      resume_plan_version: 2,
    },
  };
}

export function validateCanonicalResumePlan(plan: Record<string, unknown>): string | null {
  if (plan.schema !== "AUTO_RESTART_RESUME_PLAN_V2" || plan.plan_version !== 2) return "phase_plan_unknown";
  if (typeof plan.account_id !== "string" || !plan.account_id) return "phase_plan_account_missing";
  if (plan.package_contract_ready !== true) return "phase_plan_package_unknown";
  if (!Array.isArray(plan.phase_order) || plan.phase_order.join(",") !== "welcome,follow,unfollow") {
    return "phase_plan_order_invalid";
  }
  const phases = plan.phases_to_run as Record<string, unknown> | undefined;
  const quota = plan.quota_remaining as Record<string, unknown> | undefined;
  if (!phases || !quota) return "phase_plan_unknown";
  const enabled = ["welcome", "follow", "unfollow"].filter((phase) => phases[phase] === true);
  if (!enabled.length) return "resume_phase_plan_not_actionable";
  for (const phase of enabled) {
    const remaining = quota[phase];
    if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining <= 0) {
      return "phase_plan_quota_invalid";
    }
  }
  return null;
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
