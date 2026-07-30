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
  if (!["partial_resumable", "partial_safe_stopped"].includes(clean(input.latestTerminationClass).toLowerCase())) {
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
        : reason.includes("technical_hold")
          ? "UNFOLLOW_RESUME_BLOCKED_BY_TECHNICAL_HOLDS"
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
    run_parent: candidate.reliability.previousRunId || null,
    authorization_source: clean(input.authorizationSource) || null,
    configured_delay_minutes: candidate.configuredRestartDelayMinutes ?? null,
    delay_remaining_seconds: delayRemainingSeconds,
    phase_requested: resumePhaseKey(candidate.plannedPhasesToRun),
    follow_target: candidate.quotas.follow.capDay,
    follow_remaining: candidate.plannedQuotaRemaining.follow,
    unfollow_actionable: Number(candidate.eligibleUnfollowCandidateCount || 0),
    unfollow_holds: Number(candidate.technicalHoldUnfollowCandidateCount || 0),
    unfollow_terminal_unavailable: Number(candidate.terminalUnfollowCandidateCount || 0),
    unfollow_circuit_open: candidate.unfollowPhaseCircuitOpen === true,
    unfollow_circuit_reason: candidate.unfollowPhaseCircuitReason ?? null,
    reason,
    next_action: nextAction,
  };
}
