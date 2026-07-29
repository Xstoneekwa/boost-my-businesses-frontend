import { automaticRunCreationAllowed } from "./scheduler-authorization.ts";

export const AUTO_RESTART_TICK_TOKEN_HEADER = "x-instagram-auto-restart-tick-token";
export const AUTO_RESTART_TICK_SOURCE = "auto_restart_tick";
export { SCHEDULER_DISABLED_REASON } from "./scheduler-authorization.ts";
export const UNEXPECTED_TICK_FAILURE_REASON = "unexpected_tick_error";
const TICK_FAILURE_REASON_MAX_LENGTH = 160;

/**
 * Produces a stable, redacted failure reason for a failed tick lock.
 * Never leaks secrets: long opaque tokens, key/token/secret assignments and
 * URLs are masked before the message is persisted or exposed to operators.
 */
export function sanitizeTickFailureReason(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return UNEXPECTED_TICK_FAILURE_REASON;
  const redacted = normalized
    .replace(/\b(key|token|secret|password|authorization|bearer)\b\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bhttps?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b[A-Za-z0-9+/_-]{24,}\b/g, "[redacted]");
  const truncated = redacted.length > TICK_FAILURE_REASON_MAX_LENGTH
    ? `${redacted.slice(0, TICK_FAILURE_REASON_MAX_LENGTH)}…`
    : redacted;
  return truncated || UNEXPECTED_TICK_FAILURE_REASON;
}

/**
 * Canonical scheduler ON/OFF gate applied by the tick before any selection.
 * OFF (auto_restart_enabled=false) skips the whole tick: nothing is examined,
 * nothing is enqueued and running runs are never touched.
 * Delegates the ON/OFF decision to the single automatic-run authorization
 * contract shared with schedule-session-cron (CP0).
 */
export function schedulerTickGate(input: { enabled: boolean; mode: string; dryRun?: boolean }) {
  const executableMode = input.mode === "production" || input.mode === "active";
  const authorization = automaticRunCreationAllowed({ enabled: input.enabled });
  return {
    forceDryRun: Boolean(input.dryRun) || !authorization.allowed || !executableMode,
    skipReason: authorization.reason,
  } as const;
}

export function autoRestartTickIdempotencyKey(workerId: string, bucketStartIso: string) {
  return `auto-restart-tick:${workerId}:${bucketStartIso}`;
}

export function autoRestartTickLockBucketStart(now: Date) {
  // The production cron and embedded dispatcher both evaluate every minute.
  // Their shared lock must advance at the same cadence so a tick just before
  // an exact cooldown boundary cannot suppress the first eligible tick.
  const ms = 60_000;
  const bucket = Math.floor(now.getTime() / ms) * ms;
  return new Date(bucket).toISOString();
}

export function autoRestartEnqueueIdempotencyKey(input: {
  accountId: string;
  businessSessionId: string;
  retryIndex: number;
  progressSourceRunId?: string;
}) {
  if (input.progressSourceRunId) {
    return `auto-restart:${input.accountId}:${input.businessSessionId}:source:${input.progressSourceRunId}:retry:${input.retryIndex}`;
  }
  return `auto-restart:${input.accountId}:${input.businessSessionId}:retry:${input.retryIndex}`;
}

type ResumeCandidate = {
  [key: string]: unknown;
  restartNeeded?: boolean;
  historicalSafeBoundaryFallback?: boolean;
  safeRestartStrategy?: string;
  sourceBusinessSessionId?: string;
  nextRetryIndex?: number;
  reliability: {
    restartAllowed: boolean | null;
    restartBlockReason: string;
    sessionTerminationClass: string;
    unsafeMarkers: string[];
    businessSessionId?: string;
    retryIndex?: string;
    nextRetryIndex?: string;
    failureCategory?: string;
    failureSignature?: string;
    rootFailureCode?: string;
    cleanupCompleted?: boolean | null;
    lockReleased?: boolean | null;
    businessDaySast?: string;
    currentAttempt?: string;
    nextAttempt?: string;
    nextRestartAt?: string | null;
    lastRestartError?: string;
    lastRunId?: string;
    lastRunStatus?: string;
    sourceLabel?: string;
  };
  blockReason: string;
  gateStatus: string;
  plannedRunType?: "account_session" | "outreach_session" | "none";
  plannedPhasesToRun?: {
    welcome: boolean;
    follow: boolean;
    unfollow: boolean;
  };
  plannedQuotaRemaining?: {
    welcome: number;
    follow: number;
    unfollow: number;
    outreach: number;
  };
  eligibleUnfollowCandidateCount?: number;
  unavailableUnfollowCandidateCount?: number;
  quotas: {
    follow: ResumeCandidateQuota;
    unfollow: ResumeCandidateQuota;
    welcome: ResumeCandidateQuota;
    outreach: ResumeCandidateQuota;
  };
};

type ResumeCandidateQuota = {
  plannedNextRunQuota: number;
  remaining: number;
  doneToday?: number;
  capDay?: number;
  enabled?: boolean;
  sourceLabel?: string;
};

type ResumeRuntimeSupport = { ok: true; reason: "" } | { ok: false; reason: string };

function canonicalResumeQuotaRuntimeSupported(candidate: ResumeCandidate): ResumeRuntimeSupport {
  const phases = candidate.plannedPhasesToRun;
  const remaining = candidate.plannedQuotaRemaining;
  const runType = candidate.plannedRunType;
  if (!phases || !remaining || !runType || runType === "none") {
    return { ok: false, reason: "resume_plan_invalid" };
  }

  const phaseNames = ["welcome", "follow", "unfollow"] as const;
  const quotaNames = [...phaseNames, "outreach"] as const;
  if (quotaNames.some((phase) => !Number.isSafeInteger(remaining[phase]) || remaining[phase] < 0)) {
    return { ok: false, reason: "resume_plan_invalid" };
  }

  if (runType === "account_session") {
    if (!phaseNames.some((phase) => phases[phase]) || remaining.outreach !== 0) {
      return { ok: false, reason: "resume_plan_invalid" };
    }
  } else if (
    runType !== "outreach_session"
    || phaseNames.some((phase) => phases[phase])
    || remaining.outreach < 1
  ) {
    return { ok: false, reason: "resume_plan_invalid" };
  }

  for (const phase of phaseNames) {
    const plannedQuota = remaining[phase];
    const phaseIsPlanned = phases[phase];
    const quota = candidate.quotas[phase];
    if (phaseIsPlanned !== (plannedQuota > 0)) {
      return { ok: false, reason: "resume_plan_invalid" };
    }
    if (
      plannedQuota > 0
      && (
        quota.enabled !== true
        || plannedQuota > quota.remaining
        || plannedQuota > quota.plannedNextRunQuota
      )
    ) {
      return { ok: false, reason: "resume_plan_invalid" };
    }
  }

  const outreachQuota = candidate.quotas.outreach;
  if (
    remaining.outreach > 0
    && (
      outreachQuota.enabled !== true
      || remaining.outreach > outreachQuota.remaining
      || remaining.outreach > outreachQuota.plannedNextRunQuota
    )
  ) {
    return { ok: false, reason: "resume_plan_invalid" };
  }

  if (remaining.unfollow > 0) {
    const actionableBacklog = candidate.eligibleUnfollowCandidateCount;
    if (
      typeof actionableBacklog !== "number"
      || !Number.isSafeInteger(actionableBacklog)
      || Number(actionableBacklog) < remaining.unfollow
    ) {
      return { ok: false, reason: "resume_plan_invalid" };
    }
  }
  return { ok: true, reason: "" };
}

function evaluateResumePlanRuntimeSupport(candidate: ResumeCandidate): ResumeRuntimeSupport {
  const reliability = candidate.reliability;
  const safeBoundaryFallback = candidate.historicalSafeBoundaryFallback === true
    && candidate.restartNeeded === true
    && Boolean(candidate.safeRestartStrategy && candidate.safeRestartStrategy !== "none");
  if (reliability.restartAllowed !== true && !safeBoundaryFallback) {
    return { ok: false as const, reason: reliability.restartBlockReason || "restart_not_allowed" };
  }
  if (candidate.restartNeeded === false) {
    return { ok: false as const, reason: "no_partial_run_to_resume" };
  }
  if (candidate.safeRestartStrategy === "none") {
    return { ok: false as const, reason: "no_safe_restart_strategy" };
  }
  if (reliability.failureCategory === "recoverable_python_runtime_failure") {
    const nextRetryIndex = Number.parseInt(String(reliability.nextRetryIndex || ""), 10);
    if (
      !reliability.businessSessionId
      || ![1, 2].includes(nextRetryIndex)
      || reliability.cleanupCompleted !== true
      || reliability.lockReleased !== true
      || reliability.rootFailureCode !== "unfollow_runtime_exception"
      || reliability.failureSignature !== "python:unfollow:duplicate_stop_reason"
    ) {
      return { ok: false as const, reason: "resume_plan_invalid" };
    }
  }
  const sessionClass = reliability.sessionTerminationClass.toLowerCase();
  if (!sessionClass || sessionClass === "unknown") {
    return { ok: false as const, reason: "resume_runtime_not_supported" };
  }
  if (["completed", "success", "completed_all_phases"].includes(sessionClass)) {
    return { ok: false as const, reason: "no_partial_run_to_resume" };
  }
  if (!["partial_safe_stopped", "partial_resumable"].includes(sessionClass) && reliability.restartAllowed !== true) {
    return { ok: false as const, reason: "resume_runtime_not_supported" };
  }
  return canonicalResumeQuotaRuntimeSupported(candidate);
}

export function resumePlanRuntimeSupported(candidate: ResumeCandidate) {
  return evaluateResumePlanRuntimeSupport(candidate);
}

export function resumePlanRuntimeEvidence(candidate: ResumeCandidate) {
  const support = evaluateResumePlanRuntimeSupport(candidate);
  return {
    actionable_backlog: typeof candidate.eligibleUnfollowCandidateCount === "number"
      && Number.isSafeInteger(candidate.eligibleUnfollowCandidateCount)
      ? Number(candidate.eligibleUnfollowCandidateCount)
      : null,
    unavailable_backlog: typeof candidate.unavailableUnfollowCandidateCount === "number"
      && Number.isSafeInteger(candidate.unavailableUnfollowCandidateCount)
      ? Number(candidate.unavailableUnfollowCandidateCount)
      : null,
    planned_resume_quota: candidate.plannedQuotaRemaining ?? null,
    daily_remaining: {
      welcome: candidate.quotas.welcome.remaining,
      follow: candidate.quotas.follow.remaining,
      unfollow: candidate.quotas.unfollow.remaining,
      outreach: candidate.quotas.outreach.remaining,
    },
    session_remaining: {
      welcome: candidate.quotas.welcome.plannedNextRunQuota,
      follow: candidate.quotas.follow.plannedNextRunQuota,
      unfollow: candidate.quotas.unfollow.plannedNextRunQuota,
      outreach: candidate.quotas.outreach.plannedNextRunQuota,
    },
    runtime_supported: support.ok,
    runtime_support_block_reason: support.reason,
  };
}

export function accountRiskTier(candidate: Pick<ResumeCandidate, "reliability" | "blockReason" | "gateStatus">) {
  const markers = candidate.reliability.unsafeMarkers.join(" ").toLowerCase();
  if (/(challenge|checkpoint|restriction|action_block|account_mismatch|device_offline|cleanup_uncertain|critical_action_result_unknown|device_lock_incoherent)/.test(markers)) return "red";
  const combined = `${candidate.blockReason} ${candidate.gateStatus}`.toLowerCase();
  if (/(watch|warning|medium|yellow)/.test(combined)) return "yellow";
  return "green";
}

export function sastBusinessDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function sameSastBusinessDay(expected: string, now: Date) {
  return Boolean(expected && expected === sastBusinessDay(now));
}

export function passesRiskPolicy(
  candidate: Pick<ResumeCandidate, "reliability" | "blockReason" | "gateStatus">,
  rules: { restartYellowAccounts?: boolean; restartRedAccounts?: boolean },
) {
  const tier = accountRiskTier(candidate);
  if (tier === "red" && !rules.restartRedAccounts) return "restart_red_disabled";
  if (tier === "yellow" && !rules.restartYellowAccounts) return "restart_yellow_disabled";
  return null;
}
