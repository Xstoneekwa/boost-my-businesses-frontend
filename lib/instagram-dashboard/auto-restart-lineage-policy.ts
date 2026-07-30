import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";

export type ResumeLineageVerdict =
  | { ok: true; reason: "" }
  | {
    ok: false;
    reason:
      | "resume_lineage_mismatch"
      | "resume_source_run_superseded"
      | "resume_authorization_stale";
  };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveAttempt(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * The request linked to an ig_run is the canonical source of its attempt.
 * A run-side projection is retained only as an observable legacy fallback.
 */
export function resolveCanonicalAttemptIdentity(input: {
  sourceRunId: string;
  sourceAccountId?: string;
  sourceRequest?: {
    id?: unknown;
    account_id?: unknown;
    run_id?: unknown;
    metadata_safe?: unknown;
  } | null;
  runProjectionAttemptId?: unknown;
}) {
  const sourceRunId = clean(input.sourceRunId);
  const requestId = clean(input.sourceRequest?.id);
  const sourceAccountId = clean(input.sourceAccountId);
  const requestAccountId = clean(input.sourceRequest?.account_id);
  const requestRunId = clean(input.sourceRequest?.run_id);
  const metadata = record(input.sourceRequest?.metadata_safe);
  const resumePlan = record(metadata?.resume_plan);
  const requestAttemptId = positiveAttempt(
    metadata?.attempt_id
      ?? metadata?.current_attempt_id
      ?? resumePlan?.attempt_id
      ?? resumePlan?.current_attempt_id,
  );
  const runProjectionAttemptId = positiveAttempt(input.runProjectionAttemptId);
  const retryContractPresent = Boolean(resumePlan)
    || metadata?.resume_plan_version !== undefined
    || metadata?.retry_index !== undefined
    || metadata?.previous_run_id !== undefined
    || metadata?.prior_run_id !== undefined;
  const attemptContractMissing = retryContractPresent && requestAttemptId === null;
  const resolvedAttemptId = requestAttemptId ?? runProjectionAttemptId;
  const lineageValid = Boolean(
    sourceRunId
    && requestId
    && requestRunId === sourceRunId
    && (!sourceAccountId || requestAccountId === sourceAccountId)
    && !attemptContractMissing
    && resolvedAttemptId !== null
  );
  const canonicalAttemptId = lineageValid
    ? resolvedAttemptId
    : null;
  return {
    sourceRequestId: requestId || null,
    canonicalAttemptId,
    requestAttemptId,
    runProjectionAttemptId,
    attemptSource: requestAttemptId !== null
      ? "account_run_requests.metadata_safe.attempt_id"
      : attemptContractMissing
        ? "account_run_requests.retry_attempt_missing_fail_closed"
      : runProjectionAttemptId !== null
        ? "ig_runs.performance_summary.attempt_id_fallback"
        : "missing",
    divergence: requestAttemptId !== null
      && runProjectionAttemptId !== null
      && requestAttemptId !== runProjectionAttemptId,
    attemptContractMissing,
    lineageValid,
  } as const;
}

export function resolveCanonicalNextRetryIndex(input: {
  canonicalAttemptId?: number | null;
  retryIndex?: string | number | null;
  nextRetryIndex?: string | number | null;
}) {
  const canonical = positiveAttempt(input.canonicalAttemptId);
  const retryIndex = positiveAttempt(input.retryIndex) ?? (
    Number(input.retryIndex) === 0 ? 0 : null
  );
  const nextRetryIndex = positiveAttempt(input.nextRetryIndex) ?? (
    Number(input.nextRetryIndex) === 0 ? 0 : null
  );
  return Math.max(
    canonical ?? 0,
    nextRetryIndex ?? 0,
    retryIndex === null ? 0 : retryIndex + 1,
    1,
  );
}

export function canonicalResumePlanForLatestRun<T extends Record<string, unknown>>(
  latestRun: Record<string, unknown> | undefined,
  latestPlan: T | undefined,
): T | undefined {
  if (!latestRun || !latestPlan) return undefined;
  const runId = clean(latestRun.id);
  const planRunId = clean(latestPlan.run_id);
  return runId && planRunId && runId === planRunId ? latestPlan : undefined;
}

export function validateResumeAuthorizationLineage(input: {
  authorizationRunId: string;
  incidentRunId: string;
  storedPlanRunId: string;
  latestCanonicalRunId: string;
  latestTerminationClass: string;
  resolvedIncidentAuthorized?: boolean;
}): ResumeLineageVerdict {
  const authorizationRunId = clean(input.authorizationRunId);
  const incidentRunId = clean(input.incidentRunId);
  const storedPlanRunId = clean(input.storedPlanRunId);
  const latestCanonicalRunId = clean(input.latestCanonicalRunId);
  if (
    !authorizationRunId
    || !incidentRunId
    || !storedPlanRunId
    || authorizationRunId !== incidentRunId
    || authorizationRunId !== storedPlanRunId
  ) {
    return { ok: false, reason: "resume_lineage_mismatch" };
  }
  if (!latestCanonicalRunId || authorizationRunId !== latestCanonicalRunId) {
    return { ok: false, reason: "resume_source_run_superseded" };
  }
  const terminationClass = clean(input.latestTerminationClass).toLowerCase();
  const terminalSuccess = ["completed", "success", "completed_all_phases"].includes(terminationClass);
  // Resolving the exact incident is an explicit human authorization for one
  // new account-session boundary.  It may recover a run that was intentionally
  // classified non-recoverable before review, but it can never revive a
  // superseded lineage or an already completed session.
  if (input.resolvedIncidentAuthorized === true && !terminalSuccess) {
    return { ok: true, reason: "" };
  }
  if (!["partial_resumable", "partial_safe_stopped"].includes(terminationClass)) {
    return { ok: false, reason: "resume_authorization_stale" };
  }
  return { ok: true, reason: "" };
}

export function resumePhaseKey(phases: {
  welcome: boolean;
  follow: boolean;
  unfollow: boolean;
}) {
  return (["welcome", "follow", "unfollow"] as const)
    .filter((phase) => phases[phase])
    .join("+") || "none";
}

export function resumeReasonKey(candidate: AutoRestartCandidate) {
  return clean(candidate.reliability.rootFailureCode)
    || clean(candidate.reliability.restartBlockReason)
    || clean(candidate.reliability.sessionTerminationClass)
    || "unknown";
}

export function resumeLineageBudgetKey(candidate: AutoRestartCandidate) {
  return [
    candidate.accountId,
    clean(candidate.sourceRunId) || "missing-run",
    resumePhaseKey(candidate.plannedPhasesToRun),
    resumeReasonKey(candidate),
  ].join(":");
}

export function authoritativeDelayRemainingSeconds(nextRestartAt: string | null, now: Date) {
  if (!nextRestartAt) return 0;
  const next = Date.parse(nextRestartAt);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.ceil((next - now.getTime()) / 1000));
}

export function buildUnfollowResumeNotificationPayload(input: {
  candidate: AutoRestartCandidate;
  reason: string;
  evaluatedAt: string;
  authorizationSource?: string | null;
}) {
  const candidate = input.candidate;
  const now = new Date(input.evaluatedAt);
  const delayRemainingSeconds = authoritativeDelayRemainingSeconds(
    candidate.reliability.nextRestartAt,
    Number.isNaN(now.getTime()) ? new Date() : now,
  );
  const reason = clean(input.reason) || "eligible";
  const eventCode = reason.includes("restart_delay_not_elapsed")
    ? "UNFOLLOW_RESUME_WAITING_AUTHORITATIVE_DELAY"
    : reason.includes("resume_lineage") || reason.includes("resume_source_run") || reason.includes("resume_authorization_stale")
      ? "UNFOLLOW_RESUME_LINEAGE_MISMATCH"
      : reason.includes("circuit")
        ? "UNFOLLOW_RESUME_CIRCUIT_OPEN"
        : reason.includes("technical_hold") || reason.includes("on_cooldown")
          ? "UNFOLLOW_RESUME_BLOCKED_BY_TECHNICAL_HOLDS"
          : reason.includes("terminal_only")
            ? "UNFOLLOW_RESUME_TERMINAL_BACKLOG_ONLY"
            : reason.includes("backlog_exhausted")
              ? "UNFOLLOW_RESUME_BACKLOG_EXHAUSTED"
              : reason.includes("auto_restart_disabled") || reason === "unfollow_disabled"
                ? "UNFOLLOW_RESUME_DISABLED"
                : "UNFOLLOW_RESUME_ACTIONABLE_BACKLOG_READY";
  const nextAction = delayRemainingSeconds > 0
    ? "wait_next_natural_tick_after_delay"
    : candidate.unfollowPhaseCircuitOpen
      ? "wait_for_unfollow_circuit_cooldown"
      : Number(candidate.technicalHoldUnfollowCandidateCount || 0) > 0
        && Number(candidate.eligibleUnfollowCandidateCount || 0) <= 0
        ? "wait_for_candidate_cooldown"
        : candidate.enqueueAllowed
          ? "enqueue_bounded_unfollow_resume"
          : "do_not_enqueue";
  return {
    event_code: eventCode,
    run_source: candidate.sourceRunId || null,
    request_source: candidate.sourceRequestId ?? null,
    canonical_attempt_id: candidate.canonicalAttemptId ?? null,
    attempt_projection_divergence: candidate.reliability.attemptProjectionDivergence === true,
    lineage_valid: candidate.sourceLineageValid === true,
    run_parent: candidate.reliability.previousRunId || null,
    authorization_source: clean(input.authorizationSource) || null,
    configured_delay_minutes: candidate.configuredRestartDelayMinutes ?? null,
    delay_remaining_seconds: delayRemainingSeconds,
    phase_requested: resumePhaseKey(candidate.plannedPhasesToRun),
    follow_target: candidate.quotas.follow.capDay,
    follow_remaining: candidate.plannedQuotaRemaining.follow,
    unfollow_actionable: Number(candidate.eligibleUnfollowCandidateCount || 0),
    unfollow_remaining_total: Number(candidate.unfollowBacklogTotal || 0),
    unfollow_holds: Number(candidate.technicalHoldUnfollowCandidateCount || 0),
    unfollow_terminal_unavailable: Number(candidate.terminalUnfollowCandidateCount || 0),
    unfollow_circuit_open: candidate.unfollowPhaseCircuitOpen === true,
    unfollow_circuit_reason: candidate.unfollowPhaseCircuitReason ?? null,
    next_evaluation_at: candidate.unfollowNextEvaluationAt ?? null,
    next_candidate_retry_at: candidate.unfollowNextCandidateRetryAt ?? null,
    reason,
    next_action: nextAction,
  };
}
