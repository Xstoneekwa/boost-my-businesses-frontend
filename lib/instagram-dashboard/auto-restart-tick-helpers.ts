export const AUTO_RESTART_TICK_TOKEN_HEADER = "x-instagram-auto-restart-tick-token";
export const AUTO_RESTART_TICK_SOURCE = "auto_restart_tick";

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
