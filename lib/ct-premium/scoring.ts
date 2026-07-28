import type { CtProposalCandidate, CtProposalScore, CtScoringConfig, CtScoringSignal } from "./types.ts";

export const CT_SCORING_V1: CtScoringConfig = Object.freeze({
  version: "ct-premium-v1",
  weights: Object.freeze({
    audienceMatch: 16,
    languageMatch: 8,
    geographyMatch: 10,
    categoryMatch: 14,
    followerRangeMatch: 8,
    engagementQuality: 12,
    profileActivity: 8,
    sourceTargetPerformance: 8,
    historicalFollowbackSignal: 8,
    profileEligibilityConfidence: 8,
  }),
  thresholds: Object.freeze({ reject: 45, recommended: 75 }),
  missingProfilePenalty: 12,
});

const SIGNALS: readonly CtScoringSignal[] = Object.freeze([
  "audienceMatch", "languageMatch", "geographyMatch", "categoryMatch", "followerRangeMatch",
  "engagementQuality", "profileActivity", "sourceTargetPerformance", "historicalFollowbackSignal",
  "profileEligibilityConfidence",
]);

function boundedSignal(value: number | undefined) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? Number(value) : 0));
}

export function scoreProposalCandidate(candidate: CtProposalCandidate, config = CT_SCORING_V1): CtProposalScore {
  const breakdown: Record<string, number> = {};
  const positiveReasons: string[] = [];
  const penalties: string[] = [];
  const exclusionFlags: string[] = [];
  let total = 0;
  for (const signal of SIGNALS) {
    const contribution = Number((boundedSignal(candidate[signal]) * config.weights[signal]).toFixed(2));
    breakdown[signal] = contribution;
    total += contribution;
    if (contribution >= config.weights[signal] * 0.75) positiveReasons.push(signal);
  }
  if (!candidate.biography && candidate.followersCount == null) {
    total -= config.missingProfilePenalty;
    penalties.push("missing_profile_data");
  }
  if (candidate.isEligible === false) exclusionFlags.push("profile_not_eligible");
  total = Math.max(0, Math.min(100, Number(total.toFixed(2))));
  const band = total < config.thresholds.reject
    ? "reject"
    : total >= config.thresholds.recommended ? "recommended" : "review";
  return { version: config.version, total, band, breakdown, positiveReasons, penalties, exclusionFlags };
}
