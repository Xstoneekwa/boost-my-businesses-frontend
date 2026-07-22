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

export function autoRestartEnqueueIdempotencyKey(input: {
  accountId: string;
  businessSessionId: string;
  retryIndex: number;
}) {
  return `auto-restart:${input.accountId}:${input.businessSessionId}:retry:${input.retryIndex}`;
}

type ResumeCandidate = {
  [key: string]: unknown;
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

export function resumePlanRuntimeSupported(candidate: ResumeCandidate) {
  const reliability = candidate.reliability;
  if (reliability.restartAllowed !== true) {
    return { ok: false as const, reason: reliability.restartBlockReason || "restart_not_allowed" };
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
  if (!["partial_safe_stopped", "partial_resumable"].includes(sessionClass) && reliability.restartAllowed !== true) {
    return { ok: false as const, reason: "resume_runtime_not_supported" };
  }
  const planned = candidate.quotas;
  const hasPlannedQuotaOverride = [
    planned.follow.plannedNextRunQuota,
    planned.unfollow.plannedNextRunQuota,
    planned.welcome.plannedNextRunQuota,
    planned.outreach.plannedNextRunQuota,
  ].some((value) => value > 0 && value < (planned.follow.remaining || planned.unfollow.remaining || 1));
  if (hasPlannedQuotaOverride) {
    return { ok: false as const, reason: "resume_runtime_not_supported" };
  }
  return { ok: true as const, reason: "" };
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
