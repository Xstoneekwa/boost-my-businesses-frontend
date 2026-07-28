import type { CtShadowQualityEvaluation, CtShadowQualityThresholds, CtShadowValidationFinding, CtShadowValidationSuite } from "./types.ts";

export const CT_SHADOW_QUALITY_THRESHOLDS: Readonly<CtShadowQualityThresholds> = Object.freeze({
  maxInvariantFailures: 0,
  maxCrossAccountLeakage: 0,
  maxActivatableShadowBatches: 0,
  maxOversizedBatches: 0,
  maxDuplicateFinalProposals: 0,
  maxBlacklistedFinalProposals: 0,
  maxActiveTargetsReproposed: 0,
  maxNonDeterministicReruns: 0,
  maxNonSerializableReports: 0,
  maxReasonlessExclusions: 0,
  warningAverageScoreBelow: 55,
  warningReviewShareAbove: 0.65,
  warningDuplicateRateAbove: 0.35,
  warningBlacklistRateAbove: 0.2,
});

export function evaluateShadowQuality(suite: CtShadowValidationSuite, thresholds = CT_SHADOW_QUALITY_THRESHOLDS): CtShadowQualityEvaluation {
  const findings: CtShadowValidationFinding[] = [...suite.findings];
  const recommendations = new Set<string>();
  const criticalFailures = findings.filter((finding) => finding.verdict === "fail");
  const totalScored = Object.values(suite.aggregate.scoreBands).reduce((sum, count) => sum + count, 0);
  const reviewShare = totalScored ? suite.aggregate.scoreBands.review / totalScored : 0;
  if (suite.aggregate.averageScore !== null && suite.aggregate.averageScore < thresholds.warningAverageScoreBelow) {
    findings.push({ scenarioId: "aggregate", invariant: "average_score", verdict: "warning", message: "Average retained score is below the shadow review threshold.", evidence: { averageScore: suite.aggregate.averageScore } });
    recommendations.add("provider_quality_low");
  }
  if (reviewShare > thresholds.warningReviewShareAbove) {
    findings.push({ scenarioId: "aggregate", invariant: "score_distribution", verdict: "warning", message: "Review-band share is high.", evidence: { reviewShare } });
    recommendations.add("scoring_distribution_suspicious");
  }
  if (suite.aggregate.duplicateRate > thresholds.warningDuplicateRateAbove) recommendations.add("too_many_duplicates");
  if (suite.aggregate.blacklistRate > thresholds.warningBlacklistRateAbove) recommendations.add("too_many_blacklisted");
  if (suite.aggregate.emptyBatchRate > 0) recommendations.add("insufficient_candidates");
  if (suite.aggregate.errorRate > 0) recommendations.add("manual_review_recommended");
  if (!criticalFailures.length) recommendations.add("ready_for_future_live_shadow");
  const verdict = criticalFailures.length ? "fail" : findings.some((finding) => finding.verdict === "warning") ? "warning" : "pass";
  return Object.freeze({ verdict, findings: Object.freeze(findings), recommendations: Object.freeze([...recommendations].sort()) });
}
