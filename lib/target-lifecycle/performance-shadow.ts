import type { TargetLifecycleScope } from "./types.ts";

export type TargetPerformanceShadowState = "healthy" | "watch" | "underperforming" | "insufficient" | "stale";

export type TargetPerformanceShadowInput = TargetLifecycleScope & Readonly<{
  profilesEvaluated: number;
  eligibleProfiles: number;
  follows: number;
  skips: number;
  likes: number;
  errors: number;
  followbacks?: number | null;
  observedAt: string;
  calculatedAt: string;
  minimumVolume?: number;
  staleAfterDays?: number;
  workerIncident?: boolean;
}>;

const finiteCount = (value: number) => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
const ratio = (numerator: number, denominator: number) => denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;

export function assessTargetPerformanceShadow(input: TargetPerformanceShadowInput) {
  const profilesEvaluated = finiteCount(input.profilesEvaluated);
  const eligibleProfiles = finiteCount(input.eligibleProfiles);
  const follows = finiteCount(input.follows);
  const skips = finiteCount(input.skips);
  const likes = finiteCount(input.likes);
  const errors = finiteCount(input.errors);
  const followbacks = input.followbacks == null ? null : finiteCount(input.followbacks);
  const ageMs = Date.parse(input.calculatedAt) - Date.parse(input.observedAt);
  const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= (input.staleAfterDays ?? 14) * 86_400_000;
  const minimumVolume = Math.max(1, input.minimumVolume ?? 30);
  const eligibleYield = ratio(eligibleProfiles, profilesEvaluated);
  const followYield = ratio(follows, eligibleProfiles);
  const errorRate = ratio(errors, profilesEvaluated);
  const followbackRate = followbacks == null ? null : ratio(followbacks, follows);
  let state: TargetPerformanceShadowState = "healthy";
  const reasons: string[] = [];
  if (input.workerIncident) {
    state = "insufficient";
    reasons.push("performance_evidence_excluded_worker_incident");
  } else if (!fresh) {
    state = "stale";
    reasons.push("performance_evidence_stale");
  } else if (profilesEvaluated < minimumVolume) {
    state = "insufficient";
    reasons.push("performance_minimum_volume_not_reached");
  } else if ((errorRate ?? 0) >= 0.2 || (eligibleYield ?? 1) < 0.1 || (followYield ?? 1) < 0.1) {
    state = "underperforming";
    reasons.push("performance_yield_or_error_threshold_failed");
  } else if ((errorRate ?? 0) >= 0.1 || (eligibleYield ?? 1) < 0.2 || (followYield ?? 1) < 0.2) {
    state = "watch";
    reasons.push("performance_quality_watch");
  } else reasons.push("performance_healthy");
  return Object.freeze({
    mode: "shadow" as const,
    mutationExecuted: false as const,
    scope: Object.freeze({ tenantId: input.tenantId, accountId: input.accountId, targetId: input.targetId, normalizedUsername: input.normalizedUsername }),
    state,
    metrics: Object.freeze({ profilesEvaluated, eligibleProfiles, follows, skips, likes, errors, followbacks, eligibleYield, followYield, errorRate, followbackRate }),
    quality: Object.freeze({ minimumVolume, sufficientVolume: !input.workerIncident && profilesEvaluated >= minimumVolume, fresh, workerIncidentExcluded: input.workerIncident === true }),
    reasons: Object.freeze(reasons),
    calculatedAt: input.calculatedAt,
  });
}
