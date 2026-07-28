import type { AccountId, TargetId, TenantId } from "../types.ts";
import {
  TARGET_LIFECYCLE_THRESHOLDS,
  TARGET_LIFECYCLE_THRESHOLD_VERSION,
  assessTargetLifecycle,
  minimumEvaluatedProfilesForAudience,
  type TargetLifecycleThresholds,
} from "../../target-lifecycle/index.ts";

/** @deprecated Compatibility surface. New consumers must import target-lifecycle directly. */
export const CT_TARGET_UTILIZATION_THRESHOLD_VERSION = TARGET_LIFECYCLE_THRESHOLD_VERSION;
export type CtTargetUtilizationStatus = "insufficient_data" | "healthy" | "watch" | "replacement_recommended" | "replacement_pending" | "exhausted" | "archived" | "stale_data";
export type CtTargetUtilizationThresholds = Readonly<{
  watchRatio: number;
  replacementRatio: number;
  exhaustedRatio: number;
  minimumConfidence: number;
  followerCountFreshnessDays: number;
}>;
export const CT_TARGET_UTILIZATION_SHADOW_THRESHOLDS: CtTargetUtilizationThresholds = Object.freeze({
  watchRatio: TARGET_LIFECYCLE_THRESHOLDS.watchRatio,
  replacementRatio: TARGET_LIFECYCLE_THRESHOLDS.replacementRatio,
  exhaustedRatio: TARGET_LIFECYCLE_THRESHOLDS.exhaustedRatio,
  minimumConfidence: TARGET_LIFECYCLE_THRESHOLDS.minimumHighConfidence,
  followerCountFreshnessDays: TARGET_LIFECYCLE_THRESHOLDS.freshnessDays,
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

export type CtTargetUtilizationAssessment = ReturnType<typeof assessCtTargetUtilization>;
export const minimumProcessedProfilesForAudience = minimumEvaluatedProfilesForAudience;

export function assessCtTargetUtilization(input: CtTargetUtilizationInput) {
  const thresholds: TargetLifecycleThresholds = input.thresholds ? {
    ...TARGET_LIFECYCLE_THRESHOLDS,
    watchRatio: input.thresholds.watchRatio,
    replacementRatio: input.thresholds.replacementRatio,
    exhaustedRatio: input.thresholds.exhaustedRatio,
    minimumHighConfidence: input.thresholds.minimumConfidence,
    freshnessDays: input.thresholds.followerCountFreshnessDays,
  } : TARGET_LIFECYCLE_THRESHOLDS;
  const assessment = assessTargetLifecycle({
    tenantId: input.tenantId,
    accountId: input.accountId,
    targetId: input.targetId,
    normalizedUsername: input.normalizedUsername,
    observedFollowerCount: input.followerCountObserved,
    denominatorObservedAt: input.followerCountObservedAt,
    estimatedExploitableAudience: input.estimatedExploitableAudience,
    uniqueProfilesEvaluated: input.uniqueProfilesProcessed,
    breakdown: {
      followed: input.uniqueProfilesFollowed,
      skipped: input.uniqueProfilesSkipped,
      ineligible: input.uniqueProfilesIneligible,
      unavailable: input.uniqueProfilesUnavailable,
    },
    historicalCoverage: input.historicalCoverage,
    followbackRatio: input.followbackRatio,
    calculatedAt: input.calculatedAt,
  }, thresholds);
  return Object.freeze({
    tenantId: input.tenantId,
    accountId: input.accountId,
    targetId: input.targetId,
    normalizedUsername: assessment.scope.normalizedUsername,
    followerCountObserved: input.followerCountObserved,
    followerCountObservedAt: input.followerCountObservedAt,
    uniqueProfilesProcessed: assessment.metrics.uniqueProfilesEvaluated,
    uniqueProfilesFollowed: assessment.metrics.breakdown.followed,
    uniqueProfilesSkipped: assessment.metrics.breakdown.skipped,
    uniqueProfilesIneligible: assessment.metrics.breakdown.ineligible,
    uniqueProfilesUnavailable: assessment.metrics.breakdown.unavailable,
    estimatedExploitableAudience: input.estimatedExploitableAudience ?? null,
    denominator: assessment.metrics.denominator.value,
    denominatorKind: assessment.metrics.denominator.kind,
    rawUtilizationRatio: assessment.metrics.rawUtilizationRatio,
    utilizationRatio: assessment.metrics.utilizationRatio,
    confidence: assessment.confidence.score,
    thresholdVersion: CT_TARGET_UTILIZATION_THRESHOLD_VERSION,
    minimumAbsoluteCount: assessment.metrics.minimumAbsoluteCount,
    followerCountIsFresh: assessment.metrics.followerCountIsFresh,
    status: assessment.status === "replacement_pending" ? "replacement_recommended" as const : assessment.status,
    archiveRecommended: assessment.archiveRecommendation.recommended,
    archiveReason: assessment.archiveRecommendation.reason === "target_exploitable_audience_depleted" ? "target_audience_exhausted" as const : null,
    fbrBand: assessment.metrics.fbrBand,
    calculatedAt: assessment.calculatedAt,
  });
}
