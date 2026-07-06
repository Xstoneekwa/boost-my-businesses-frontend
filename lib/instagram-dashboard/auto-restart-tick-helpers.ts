export const AUTO_RESTART_TICK_TOKEN_HEADER = "x-instagram-auto-restart-tick-token";
export const AUTO_RESTART_TICK_SOURCE = "auto_restart_tick";
export const SCHEDULER_DISABLED_REASON = "scheduler_disabled";
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
 */
export function schedulerTickGate(input: { enabled: boolean; mode: string; dryRun?: boolean }) {
  const executableMode = input.mode === "production" || input.mode === "active";
  return {
    forceDryRun: Boolean(input.dryRun) || !input.enabled || !executableMode,
    skipReason: input.enabled ? null : SCHEDULER_DISABLED_REASON,
  } as const;
}

export function autoRestartTickIdempotencyKey(workerId: string, bucketStartIso: string) {
  return `auto-restart-tick:${workerId}:${bucketStartIso}`;
}

export function autoRestartEnqueueIdempotencyKey(input: {
  accountId: string;
  businessSessionId: string;
  tickBucketIso: string;
}) {
  return `auto-restart:${input.accountId}:${input.businessSessionId}:${input.tickBucketIso}`;
}

type ResumeCandidate = {
  reliability: {
    restartAllowed: boolean | null;
    restartBlockReason: string;
    sessionTerminationClass: string;
    unsafeMarkers: string[];
  };
  blockReason: string;
  gateStatus: string;
  quotas: {
    follow: { plannedNextRunQuota: number; remaining: number };
    unfollow: { plannedNextRunQuota: number; remaining: number };
    welcome: { plannedNextRunQuota: number; remaining: number };
    outreach: { plannedNextRunQuota: number; remaining: number };
  };
};

export function resumePlanRuntimeSupported(candidate: ResumeCandidate) {
  const reliability = candidate.reliability;
  if (reliability.restartAllowed !== true) {
    return { ok: false as const, reason: reliability.restartBlockReason || "restart_not_allowed" };
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
  const block = candidate.blockReason.toLowerCase();
  const combined = `${markers} ${block} ${candidate.gateStatus}`;
  if (/(critical|high|problem|blocked|failed)/.test(combined)) return "red";
  if (/(watch|warning|medium|yellow)/.test(combined)) return "yellow";
  return "green";
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
