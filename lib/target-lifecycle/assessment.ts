import {
  TARGET_LIFECYCLE_THRESHOLDS,
  TARGET_LIFECYCLE_THRESHOLD_VERSION,
  minimumEvaluatedProfilesForAudience,
  type TargetLifecycleThresholds,
} from "./config.ts";
import type {
  TargetLifecycleAssessment,
  TargetLifecycleAssessmentInput,
  TargetLifecycleReason,
  TargetLifecycleStatus,
  TargetLifecycleTransition,
  TargetUtilizationBreakdown,
} from "./types.ts";

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const count = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
const score = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value) : fallback;

function fbrBand(value: number | null | undefined): "unknown" | "low" | "average" | "good" {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "unknown";
  if (value < 8) return "low";
  if (value < 15) return "average";
  return "good";
}

export function assessTargetLifecycle(
  input: TargetLifecycleAssessmentInput,
  thresholds: Readonly<TargetLifecycleThresholds> = TARGET_LIFECYCLE_THRESHOLDS,
): TargetLifecycleAssessment {
  const uniqueProfilesEvaluated = count(input.uniqueProfilesEvaluated);
  const estimated = count(input.estimatedExploitableAudience);
  const followers = count(input.observedFollowerCount);
  const denominatorValue = estimated && estimated > 0 ? estimated : followers && followers > 0 ? followers : null;
  const denominatorKind = estimated && estimated > 0
    ? "estimated_exploitable_audience" as const
    : denominatorValue
      ? "observed_follower_count" as const
      : "unavailable" as const;
  const breakdown: TargetUtilizationBreakdown = {
    followed: count(input.breakdown?.followed),
    skipped: count(input.breakdown?.skipped),
    ineligible: count(input.breakdown?.ineligible),
    unavailable: count(input.breakdown?.unavailable),
    alreadyProcessed: count(input.breakdown?.alreadyProcessed),
    duplicate: count(input.breakdown?.duplicate),
    blacklisted: count(input.breakdown?.blacklisted),
  };
  const now = Date.parse(input.calculatedAt);
  const observed = input.denominatorObservedAt ? Date.parse(input.denominatorObservedAt) : Number.NaN;
  const age = now - observed;
  const followerCountIsFresh = Number.isFinite(now) && Number.isFinite(observed) && age >= 0
    && age <= thresholds.freshnessDays * 86_400_000;
  const rawRatio = denominatorValue && uniqueProfilesEvaluated !== null ? uniqueProfilesEvaluated / denominatorValue : null;
  const utilizationRatio = rawRatio === null ? null : clamp(rawRatio);
  const minimumAbsoluteCount = minimumEvaluatedProfilesForAudience(denominatorValue);
  const factors = Object.freeze({
    freshness: followerCountIsFresh ? 1 : 0,
    historicalCoverage: score(input.historicalCoverage, 0),
    uniqueEvaluationCoverage: score(input.uniqueEvaluationCoverage, uniqueProfilesEvaluated === null ? 0 : 1),
    denominatorReliability: score(input.denominatorReliability, denominatorKind === "estimated_exploitable_audience" ? 1 : 0.75),
    sourceAttributionReliability: score(input.sourceAttributionReliability, 0.75),
    workerVersionCoverage: score(input.workerVersionCoverage, 0.75),
  });
  let confidenceScore = Object.values(factors).reduce((sum, value) => sum + value, 0) / 6;
  if (rawRatio !== null && rawRatio > 1) confidenceScore -= 0.25;
  confidenceScore = Number(clamp(confidenceScore).toFixed(2));
  const confidenceLevel = confidenceScore >= thresholds.minimumHighConfidence ? "high" : confidenceScore >= 0.5 ? "medium" : "low";
  const confidenceReasons: TargetLifecycleReason[] = [];
  if (!followerCountIsFresh) confidenceReasons.push("target_follower_count_stale");
  if (confidenceLevel === "low") confidenceReasons.push("target_utilization_confidence_low");

  let status: TargetLifecycleStatus;
  let reason: TargetLifecycleReason;
  if (input.archived) [status, reason] = ["archived", "target_archived"];
  else if (!denominatorValue || uniqueProfilesEvaluated === null) [status, reason] = ["insufficient_data", "target_utilization_data_insufficient"];
  else if (!followerCountIsFresh) [status, reason] = ["stale_data", "target_follower_count_stale"];
  else if (confidenceLevel === "low" || rawRatio !== null && rawRatio > 1) [status, reason] = ["insufficient_data", "target_utilization_confidence_low"];
  else if (utilizationRatio !== null && utilizationRatio >= thresholds.exhaustedRatio
    && uniqueProfilesEvaluated >= minimumAbsoluteCount && confidenceLevel === "high") {
    [status, reason] = ["exhausted", "target_exploitable_audience_depleted"];
  } else if (input.replacementState === "pending" || input.replacementState === "ready_for_review"
    || utilizationRatio !== null && utilizationRatio >= thresholds.replacementPendingRatio
      && uniqueProfilesEvaluated >= minimumAbsoluteCount) {
    [status, reason] = ["replacement_pending", "target_replacement_pending"];
  } else if (utilizationRatio !== null && utilizationRatio >= thresholds.replacementRatio
    && uniqueProfilesEvaluated >= minimumAbsoluteCount) {
    [status, reason] = ["replacement_recommended", "target_replacement_recommended"];
  } else if (utilizationRatio !== null && utilizationRatio >= thresholds.watchRatio) {
    [status, reason] = ["watch", "target_utilization_threshold_reached"];
  } else [status, reason] = ["healthy", "target_healthy"];

  const terminalProof = Boolean(input.terminalProof && utilizationRatio !== null
    && utilizationRatio >= thresholds.terminalConfirmationRatio && confidenceLevel === "high");
  const archiveRecommended = status === "exhausted";
  const exhaustionReasons = status === "exhausted" ? [reason, "target_audience_exhausted" as const] : [reason];
  const reasons = terminalProof ? [...exhaustionReasons, "target_archived_terminal_exhaustion" as const] : exhaustionReasons;
  return Object.freeze({
    scope: Object.freeze({
      tenantId: input.tenantId,
      accountId: input.accountId,
      targetId: input.targetId,
      normalizedUsername: input.normalizedUsername.trim().replace(/^@+/, "").toLowerCase(),
    }),
    status,
    metrics: Object.freeze({
      uniqueProfilesEvaluated,
      breakdown: Object.freeze(breakdown),
      denominator: Object.freeze({
        value: denominatorValue,
        kind: denominatorKind,
        version: input.denominatorVersion ?? "unversioned",
        source: input.denominatorSource ?? "unknown",
        observedAt: input.denominatorObservedAt,
        reliability: factors.denominatorReliability,
      }),
      rawUtilizationRatio: rawRatio === null ? null : Number(rawRatio.toFixed(4)),
      utilizationRatio: utilizationRatio === null ? null : Number(utilizationRatio.toFixed(4)),
      minimumAbsoluteCount,
      followerCountIsFresh,
      followbackRatio: input.followbackRatio ?? null,
      fbrBand: fbrBand(input.followbackRatio),
    }),
    confidence: Object.freeze({ score: confidenceScore, level: confidenceLevel, factors, reasons: confidenceReasons }),
    reasons,
    archiveRecommendation: Object.freeze({
      recommended: archiveRecommended,
      terminalProof,
      reason: archiveRecommended ? "target_exploitable_audience_depleted" : null,
    }),
    availability: input.availability ?? null,
    thresholdVersion: TARGET_LIFECYCLE_THRESHOLD_VERSION,
    calculatedAt: input.calculatedAt,
  });
}

export function recommendTargetLifecycleTransition(
  from: TargetLifecycleStatus,
  assessment: TargetLifecycleAssessment,
): TargetLifecycleTransition {
  const to = assessment.status;
  const allowed = from !== "archived" || to === "archived";
  return Object.freeze({ from, to: allowed ? to : from, allowed, reason: allowed ? assessment.reasons[0] : "target_archived" });
}
