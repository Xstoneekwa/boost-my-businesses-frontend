import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";

/** Rebuild a resolved incident from live canonical quotas, never its stale snapshot. */
export function rebuildResolvedIncidentResumeCandidate(
  candidate: AutoRestartCandidate,
): AutoRestartCandidate {
  const welcome = candidate.quotas.welcome.enabled && candidate.quotas.welcome.remaining > 0;
  const follow = candidate.quotas.follow.enabled
    && candidate.quotas.follow.remaining > 0
    && Number(candidate.eligibleFollowTargetCount || 0) > 0;
  const actionableUnfollow = Math.max(
    0,
    Number(candidate.eligibleUnfollowCandidateCount || 0),
  );
  const unfollow = candidate.quotas.unfollow.enabled
    && candidate.quotas.unfollow.remaining > 0
    && actionableUnfollow > 0
    && candidate.unfollowPhaseCircuitOpen !== true;
  const phases = { welcome, follow, unfollow };
  const remaining = {
    welcome: welcome ? candidate.quotas.welcome.remaining : 0,
    follow: follow ? candidate.quotas.follow.remaining : 0,
    unfollow: unfollow
      ? Math.min(candidate.quotas.unfollow.remaining, actionableUnfollow)
      : 0,
    outreach: candidate.quotas.outreach.enabled ? candidate.quotas.outreach.remaining : 0,
  };
  const actionable = Object.values(phases).some(Boolean);
  const rebuiltFollowStrategy = follow
    ? candidate.exactViewportResumeAvailable
      ? candidate.safeRestartStrategy
      : candidate.nextTargetId
        ? "next_target"
        : "rebuilt_safe_target_plan"
    : candidate.safeRestartStrategy;

  return {
    ...candidate,
    accountEligible: actionable,
    accountEligibilityReason: actionable ? "resolved_incident_live_plan_rebuilt" : "resume_phase_plan_not_actionable",
    restartNeeded: actionable,
    restartNeedReason: actionable ? "resolved_incident_live_plan_rebuilt" : "resume_phase_plan_not_actionable",
    safeRestartStrategy: rebuiltFollowStrategy,
    safeRestartReason: follow && rebuiltFollowStrategy === "rebuilt_safe_target_plan"
      ? "resolved_incident_canonical_target_plan_rebuild"
      : candidate.safeRestartReason,
    enqueueAllowed: actionable,
    remainingFollowQuota: remaining.follow,
    plannedPhasesToRun: phases,
    plannedQuotaRemaining: remaining,
    plannedRunType: actionable ? "account_session" : "none",
    restartEligible: actionable,
    decisionOutcome: actionable ? "eligible" : "not_needed",
    blockReason: actionable ? "" : "resume_phase_plan_not_actionable",
  };
}

export function buildInstagramRestrictionPreflightMetadata(input: {
  accountId: string;
  assignmentId: string | null;
  deviceId: string | null;
  appInstanceId: string | null;
  incidentId: string;
  authorizationId: string;
  resumePlanId: string;
  originalRunId: string;
  retryGeneration: number;
  now: Date;
}) {
  const phases = { welcome: false, follow: false, unfollow: false };
  const quota = { welcome: 0, follow: 0, unfollow: 0, outreach: 0, total: 0 };
  return {
    resume_plan_version: 2,
    resume_plan_schema: "AUTO_RESTART_RESUME_PLAN_V2",
    prior_run_id: input.originalRunId,
    restriction_preflight_only: true,
    incident_id: input.incidentId,
    authorization_id: input.authorizationId,
    resume_plan: {
      schema: "AUTO_RESTART_RESUME_PLAN_V2",
      plan_version: 2,
      resume_kind: "instagram_restriction_preflight",
      restriction_preflight_only: true,
      account_id: input.accountId,
      assignment_id: input.assignmentId,
      device_id: input.deviceId,
      app_instance_id: input.appInstanceId,
      incident_id: input.incidentId,
      authorization_id: input.authorizationId,
      resume_plan_id: input.resumePlanId,
      prior_run_id: input.originalRunId,
      phase_order: ["welcome", "follow", "unfollow"],
      phases_to_run: phases,
      quota_remaining: quota,
      retry_generation: input.retryGeneration,
      scheduled_at: input.now.toISOString(),
    },
  };
}

export function buildAutoRestartResumePlanMetadata(candidate: AutoRestartCandidate, now = new Date()) {
  const reliability = candidate.reliability;
  const retryIndex = candidate.nextRetryIndex;
  const attemptId = retryIndex + 1;
  return {
    resume_plan_version: 2,
    resume_plan_schema: "AUTO_RESTART_RESUME_PLAN_V2",
    prior_run_id: candidate.sourceRunId || null,
    source_run_id: candidate.sourceRunId || null,
    source_request_id: candidate.sourceRequestId ?? null,
    source_canonical_attempt_id: candidate.canonicalAttemptId ?? null,
    source_attempt_id_source: reliability.attemptSource ?? null,
    source_attempt_projection_id: reliability.attemptProjectionId ?? null,
    source_attempt_projection_divergence: reliability.attemptProjectionDivergence === true,
    source_lineage_valid: candidate.sourceLineageValid === true,
    source_phase_status: reliability.unfollowPhaseStatus ?? null,
    source_session_target: reliability.unfollowSessionTarget ?? null,
    source_session_verified: reliability.unfollowSessionVerified ?? null,
    session_termination_class: reliability.sessionTerminationClass || null,
    restart_block_reason: candidate.enqueueAllowed ? null : reliability.restartBlockReason || null,
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
    operator_stop_continuation: candidate.operatorStopContinuation,
    operator_stop_source_reason: candidate.operatorStopReason,
    fresh_boundary_only: candidate.freshBoundaryOnly,
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
      follow_enabled: candidate.plannedPhasesToRun.follow,
      unfollow_enabled: candidate.plannedPhasesToRun.unfollow,
      outreach_enabled: candidate.quotas.outreach.enabled,
      follow_target: candidate.plannedQuotaRemaining.follow,
      follow_remaining: candidate.plannedQuotaRemaining.follow,
      follow_session_override: candidate.followSessionOverride ?? null,
      max_follows_per_target_per_run: candidate.maxFollowsPerTargetPerRun ?? null,
      max_targets_per_run: candidate.maxTargetsPerRun ?? null,
      unfollow_target: candidate.plannedQuotaRemaining.unfollow,
      unfollow_remaining: candidate.plannedQuotaRemaining.unfollow,
      outreach_remaining: candidate.plannedQuotaRemaining.outreach,
      candidate_counts: {
        follow_targets: candidate.eligibleFollowTargetCount,
        unfollow_candidates: candidate.eligibleUnfollowCandidateCount ?? null,
        unfollow_remaining_total: candidate.unfollowBacklogTotal ?? null,
        unfollow_unavailable: candidate.unavailableUnfollowCandidateCount ?? null,
        unfollow_terminal_unavailable: candidate.terminalUnfollowCandidateCount ?? null,
        unfollow_technical_hold: candidate.technicalHoldUnfollowCandidateCount ?? null,
        unfollow_next_candidate_retry_at: candidate.unfollowNextCandidateRetryAt ?? null,
        unfollow_next_evaluation_at: candidate.unfollowNextEvaluationAt ?? null,
        welcome_candidates: null,
        source: "canonical_backend_candidate_projection",
      },
      unfollow_phase_circuit: {
        open: candidate.unfollowPhaseCircuitOpen === true,
        reason: candidate.unfollowPhaseCircuitReason ?? null,
        next_retry_at: candidate.unfollowPhaseCircuitNextRetryAt ?? null,
      },
      restart_allowed: candidate.enqueueAllowed,
      restart_block_reason: candidate.enqueueAllowed ? "" : reliability.restartBlockReason || "",
      session_termination_class: reliability.sessionTerminationClass || "",
      business_session_id: candidate.sourceBusinessSessionId || null,
      attempt_id: attemptId,
      retry_index: retryIndex,
      next_retry_index: retryIndex,
      previous_run_id: candidate.sourceRunId || reliability.previousRunId || null,
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
      operator_stop_continuation: candidate.operatorStopContinuation,
      operator_stop_source_reason: candidate.operatorStopReason,
      fresh_boundary_only: candidate.freshBoundaryOnly,
      prior_target_id: candidate.priorTargetId,
      next_target_id: candidate.nextTargetId,
      phases_to_run: candidate.plannedPhasesToRun,
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
        follow: candidate.plannedQuotaRemaining.follow,
        unfollow: candidate.plannedQuotaRemaining.unfollow,
        welcome: candidate.plannedQuotaRemaining.welcome,
        outreach: candidate.plannedQuotaRemaining.outreach,
      },
      // The Worker owns this opaque checkpoint contract. Auto Restart must
      // transport it byte-for-byte so the next run reuses the frozen Daily
      // Plan instead of rebuilding a fresh cohort from current eligibility.
      unfollow_checkpoint: candidate.reliability.unfollowCheckpoint ?? null,
      prior_run_id: candidate.sourceRunId || null,
      source_run_id: candidate.sourceRunId || null,
      source_request_id: candidate.sourceRequestId ?? null,
      source_canonical_attempt_id: candidate.canonicalAttemptId ?? null,
      source_lineage_valid: candidate.sourceLineageValid === true,
      source_phase_status: reliability.unfollowPhaseStatus ?? null,
      source_session_target: reliability.unfollowSessionTarget ?? null,
      source_session_verified: reliability.unfollowSessionVerified ?? null,
      canonical_live_unfollow_resume: candidate.canonicalLiveUnfollowResumeAuthorized === true,
      resume_plan_version: 2,
    },
  };
}

export const FOLLOW_60S_ONE_SHOT_SCHEMA = "FOLLOW_60S_ONE_SHOT_V2";
const LEGACY_FOLLOW_60S_ONE_SHOT_SCHEMAS = new Set([
  FOLLOW_60S_ONE_SHOT_SCHEMA,
  "REX_FOLLOW_60S_ONE_SHOT_V2",
]);

type AutoRestartResumeMetadata = ReturnType<typeof buildAutoRestartResumePlanMetadata>;
type Follow60sResumeMetadata = Omit<AutoRestartResumeMetadata, "resume_plan"> & {
  resume_plan: AutoRestartResumeMetadata["resume_plan"] & {
    follow_60s_canary_contract?: Record<string, unknown>;
    phase_plan_source?: "follow60_armed_control";
    preserved_business_backlog?: {
      welcome: number;
      unfollow: number;
      outreach: number;
    };
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Build the Follow-only phase plan from an explicitly frozen Follow60 contract.
 * The contract account must match the authorization and frozen plan; there is
 * deliberately no username/account allowlist in source.
 */
export function applyFollow60sOneShotFrozenPlan(input: {
  baseMetadata: AutoRestartResumeMetadata;
  frozenPlan: unknown;
  authorizationAccountId: string;
  originalRunId: string;
  liveFollowRemaining: number;
}): {
  matched: boolean;
  ok: boolean;
  reason: string;
  metadata: Follow60sResumeMetadata;
} {
  const frozenPlan = record(input.frozenPlan);
  const contract = record(frozenPlan.follow_60s_canary_contract);
  if (!Object.keys(contract).length) {
    return { matched: false, ok: true, reason: "", metadata: input.baseMetadata };
  }

  const reject = (reason: string) => ({
    matched: true,
    ok: false,
    reason,
    metadata: input.baseMetadata,
  });
  const phases = record(frozenPlan.phases_to_run);
  const quota = record(frozenPlan.quota_remaining);
  const followQuota = Number(contract.follow_quota);
  const liveFollowRemaining = Number(input.liveFollowRemaining);

  if (
    !input.authorizationAccountId
    || frozenPlan.account_id !== input.authorizationAccountId
  ) return reject("follow_60s_one_shot_account_mismatch");
  if (
    !LEGACY_FOLLOW_60S_ONE_SHOT_SCHEMAS.has(String(contract.schema || ""))
    || contract.source_run_id !== input.originalRunId
    || contract.golden_fallback_policy !== "proof_rejection_only"
  ) return reject("follow_60s_one_shot_contract_invalid");
  const expiresAtMs = Date.parse(String(contract.expires_at || ""));
  const scheduledAtMs = Date.parse(String(input.baseMetadata.scheduled_at || ""));
  if (
    !Number.isFinite(expiresAtMs)
    || !Number.isFinite(scheduledAtMs)
    || scheduledAtMs >= expiresAtMs
  ) return reject("follow_60s_one_shot_expired");
  if (
    frozenPlan.schema !== "AUTO_RESTART_RESUME_PLAN_V2"
    || frozenPlan.plan_version !== 2
    || frozenPlan.package_contract_ready !== true
    || !Array.isArray(frozenPlan.phase_order)
    || frozenPlan.phase_order.join(",") !== "welcome,follow,unfollow"
  ) return reject("follow_60s_one_shot_plan_invalid");
  if (phases.follow !== true) {
    return reject("follow_60s_one_shot_phase_scope_invalid");
  }
  if (
    !Number.isInteger(followQuota)
    || followQuota <= 0
    || followQuota > 50
    || Number(quota.follow) !== followQuota
  ) return reject("follow_60s_one_shot_quota_invalid");
  if (!Number.isFinite(liveFollowRemaining) || liveFollowRemaining !== followQuota) {
    return reject("follow_60s_one_shot_live_quota_mismatch");
  }

  return {
    matched: true,
    ok: true,
    reason: "",
    metadata: {
      ...input.baseMetadata,
      remaining_follow_quota: followQuota,
      resume_plan: {
        ...input.baseMetadata.resume_plan,
        ...frozenPlan,
        follow_60s_canary_contract: {
          ...contract,
          // Normalize legacy Rex controls at plan construction.  The Worker
          // accepts one account-neutral schema and never needs account source
          // special-casing during activation.
          schema: FOLLOW_60S_ONE_SHOT_SCHEMA,
        },
        phases_to_run: {
          welcome: false,
          follow: true,
          unfollow: false,
        },
        quota_remaining: {
          welcome: 0,
          follow: followQuota,
          unfollow: 0,
          outreach: 0,
        },
        phase_plan_source: "follow60_armed_control",
        preserved_business_backlog: {
          welcome: Math.max(0, Number(quota.welcome) || 0),
          unfollow: Math.max(0, Number(quota.unfollow) || 0),
          outreach: Math.max(0, Number(quota.outreach) || 0),
        },
      },
    },
  };
}

export function validateCanonicalResumePlan(plan: Record<string, unknown>): string | null {
  if (plan.schema !== "AUTO_RESTART_RESUME_PLAN_V2" || plan.plan_version !== 2) return "phase_plan_unknown";
  if (typeof plan.account_id !== "string" || !plan.account_id) return "phase_plan_account_missing";
  if (plan.restriction_preflight_only === true) {
    if (plan.resume_kind !== "instagram_restriction_preflight") return "restriction_preflight_contract_invalid";
    if (typeof plan.incident_id !== "string" || !plan.incident_id) return "restriction_preflight_contract_invalid";
    if (typeof plan.authorization_id !== "string" || !plan.authorization_id) return "restriction_preflight_contract_invalid";
    const phases = plan.phases_to_run as Record<string, unknown> | undefined;
    const quota = plan.quota_remaining as Record<string, unknown> | undefined;
    if (!phases || !quota) return "restriction_preflight_contract_invalid";
    if (["welcome", "follow", "unfollow"].some((phase) => phases[phase] !== false)) {
      return "restriction_preflight_contract_invalid";
    }
    if (["welcome", "follow", "unfollow", "outreach", "total"].some((phase) => quota[phase] !== 0)) {
      return "restriction_preflight_contract_invalid";
    }
    return null;
  }
  if (plan.package_contract_ready !== true) return "phase_plan_package_unknown";
  const order = Array.isArray(plan.phase_order) ? plan.phase_order.join(",") : "";
  const recoveryFirst = order === "post_follow_recovery,welcome,follow,unfollow";
  if (order !== "welcome,follow,unfollow" && !recoveryFirst) {
    return "phase_plan_order_invalid";
  }
  const phases = plan.phases_to_run as Record<string, unknown> | undefined;
  const quota = plan.quota_remaining as Record<string, unknown> | undefined;
  if (!phases || !quota) return "phase_plan_unknown";
  if (recoveryFirst) {
    if (
      phases.post_follow_recovery !== true
      || plan.safe_next_step !== "post_follow_recovery"
      || phases.follow !== true
    ) return "post_follow_recovery_contract_invalid";
  } else if (phases.post_follow_recovery === true) {
    return "post_follow_recovery_contract_invalid";
  }
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
