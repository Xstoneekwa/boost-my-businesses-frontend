import type { AccountId, TargetId, TenantId } from "../types.ts";

export const CT_TARGET_UTILIZATION_THRESHOLD_VERSION = "ct-target-utilization-shadow-v1";

export type CtTargetUtilizationStatus =
  | "insufficient_data"
  | "healthy"
  | "watch"
  | "replacement_recommended"
  | "exhausted"
  | "stale_data";

export type CtTargetUtilizationThresholds = Readonly<{
  watchRatio: number;
  replacementRatio: number;
  exhaustedRatio: number;
  minimumConfidence: number;
  followerCountFreshnessDays: number;
}>;

export const CT_TARGET_UTILIZATION_SHADOW_THRESHOLDS: CtTargetUtilizationThresholds = Object.freeze({
  watchRatio: 0.75,
  replacementRatio: 0.8,
  exhaustedRatio: 0.9,
  minimumConfidence: 0.8,
  followerCountFreshnessDays: 14,
});

export type CtTargetUtilizationInput = Readonly<{
  tenantId: TenantId;
  accountId: AccountId;
  targetId: TargetId;
  normalizedUsername: string;
  followerCountObserved: number | null;
  followerCountObservedAt: string | null;
  uniqueProfilesProcessed: number | null;
  uniqueProfilesFollowed: number | null;
  uniqueProfilesSkipped: number | null;
  uniqueProfilesIneligible: number | null;
  uniqueProfilesUnavailable: number | null;
  estimatedExploitableAudience?: number | null;
  historicalCoverage: number;
  followbackRatio?: number | null;
  calculatedAt: string;
  thresholds?: CtTargetUtilizationThresholds;
}>;

export type CtTargetUtilizationAssessment = Readonly<{
  tenantId: TenantId;
  accountId: AccountId;
  targetId: TargetId;
  normalizedUsername: string;
  followerCountObserved: number | null;
  followerCountObservedAt: string | null;
  uniqueProfilesProcessed: number | null;
  uniqueProfilesFollowed: number | null;
  uniqueProfilesSkipped: number | null;
  uniqueProfilesIneligible: number | null;
  uniqueProfilesUnavailable: number | null;
  estimatedExploitableAudience: number | null;
  denominator: number | null;
  denominatorKind: "estimated_exploitable_audience" | "observed_follower_count" | "unavailable";
  rawUtilizationRatio: number | null;
  utilizationRatio: number | null;
  confidence: number;
  thresholdVersion: typeof CT_TARGET_UTILIZATION_THRESHOLD_VERSION;
  minimumAbsoluteCount: number;
  followerCountIsFresh: boolean;
  status: CtTargetUtilizationStatus;
  archiveRecommended: boolean;
  archiveReason: "target_audience_exhausted" | null;
  fbrBand: "unknown" | "low" | "average" | "good";
  calculatedAt: string;
}>;

function count(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function bounded(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function minimumProcessedProfilesForAudience(audience: number | null) {
  if (audience === null || audience <= 0) return 0;
  if (audience < 500) return 250;
  if (audience < 2_000) return 500;
  if (audience < 10_000) return 1_000;
  return 2_500;
}

function fbrBand(value: number | null | undefined): CtTargetUtilizationAssessment["fbrBand"] {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "unknown";
  if (value < 8) return "low";
  if (value < 15) return "average";
  return "good";
}

export function assessCtTargetUtilization(input: CtTargetUtilizationInput): CtTargetUtilizationAssessment {
  const thresholds = input.thresholds ?? CT_TARGET_UTILIZATION_SHADOW_THRESHOLDS;
  const followerCountObserved = count(input.followerCountObserved);
  const estimatedExploitableAudience = count(input.estimatedExploitableAudience);
  const uniqueProfilesProcessed = count(input.uniqueProfilesProcessed);
  const uniqueProfilesFollowed = count(input.uniqueProfilesFollowed);
  const uniqueProfilesSkipped = count(input.uniqueProfilesSkipped);
  const uniqueProfilesIneligible = count(input.uniqueProfilesIneligible);
  const uniqueProfilesUnavailable = count(input.uniqueProfilesUnavailable);
  const denominator = estimatedExploitableAudience && estimatedExploitableAudience > 0
    ? estimatedExploitableAudience
    : followerCountObserved && followerCountObserved > 0
      ? followerCountObserved
      : null;
  const denominatorKind = estimatedExploitableAudience && estimatedExploitableAudience > 0
    ? "estimated_exploitable_audience" as const
    : denominator
      ? "observed_follower_count" as const
      : "unavailable" as const;
  const calculatedAtMs = Date.parse(input.calculatedAt);
  const observedAtMs = input.followerCountObservedAt ? Date.parse(input.followerCountObservedAt) : Number.NaN;
  const ageMs = calculatedAtMs - observedAtMs;
  const followerCountIsFresh = Number.isFinite(calculatedAtMs)
    && Number.isFinite(observedAtMs)
    && ageMs >= 0
    && ageMs <= thresholds.followerCountFreshnessDays * 86_400_000;
  const rawUtilizationRatio = denominator && uniqueProfilesProcessed !== null
    ? uniqueProfilesProcessed / denominator
    : null;
  const utilizationRatio = rawUtilizationRatio === null ? null : bounded(rawUtilizationRatio);
  const breakdown = [uniqueProfilesFollowed, uniqueProfilesSkipped, uniqueProfilesIneligible, uniqueProfilesUnavailable];
  const breakdownComplete = breakdown.every((value) => value !== null);
  const breakdownTotal = breakdown.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const breakdownConsistent = breakdownComplete
    && uniqueProfilesProcessed !== null
    && breakdownTotal <= uniqueProfilesProcessed;
  let confidence = 0;
  if (followerCountIsFresh) confidence += 0.3;
  confidence += 0.3 * bounded(input.historicalCoverage);
  if (breakdownConsistent) confidence += 0.2;
  if (denominatorKind === "estimated_exploitable_audience") confidence += 0.2;
  else if (denominatorKind === "observed_follower_count") confidence += 0.15;
  if (rawUtilizationRatio !== null && rawUtilizationRatio > 1) confidence -= 0.25;
  confidence = Number(bounded(confidence).toFixed(2));
  const minimumAbsoluteCount = minimumProcessedProfilesForAudience(denominator);

  let status: CtTargetUtilizationStatus;
  if (!denominator || uniqueProfilesProcessed === null) status = "insufficient_data";
  else if (!followerCountIsFresh) status = "stale_data";
  else if (confidence < 0.5) status = "insufficient_data";
  else if (
    utilizationRatio !== null
    && utilizationRatio >= thresholds.exhaustedRatio
    && uniqueProfilesProcessed >= minimumAbsoluteCount
    && confidence >= thresholds.minimumConfidence
  ) status = "exhausted";
  else if (
    utilizationRatio !== null
    && utilizationRatio >= thresholds.replacementRatio
    && uniqueProfilesProcessed >= minimumAbsoluteCount
  ) status = "replacement_recommended";
  else if (utilizationRatio !== null && utilizationRatio >= thresholds.watchRatio) status = "watch";
  else status = "healthy";

  return Object.freeze({
    tenantId: input.tenantId,
    accountId: input.accountId,
    targetId: input.targetId,
    normalizedUsername: input.normalizedUsername.trim().replace(/^@+/, "").toLowerCase(),
    followerCountObserved,
    followerCountObservedAt: input.followerCountObservedAt,
    uniqueProfilesProcessed,
    uniqueProfilesFollowed,
    uniqueProfilesSkipped,
    uniqueProfilesIneligible,
    uniqueProfilesUnavailable,
    estimatedExploitableAudience,
    denominator,
    denominatorKind,
    rawUtilizationRatio: rawUtilizationRatio === null ? null : Number(rawUtilizationRatio.toFixed(4)),
    utilizationRatio: utilizationRatio === null ? null : Number(utilizationRatio.toFixed(4)),
    confidence,
    thresholdVersion: CT_TARGET_UTILIZATION_THRESHOLD_VERSION,
    minimumAbsoluteCount,
    followerCountIsFresh,
    status,
    archiveRecommended: status === "exhausted",
    archiveReason: status === "exhausted" ? "target_audience_exhausted" : null,
    fbrBand: fbrBand(input.followbackRatio),
    calculatedAt: input.calculatedAt,
  });
}
