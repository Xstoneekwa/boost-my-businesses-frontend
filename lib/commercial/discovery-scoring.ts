import {
  COMMERCIAL_SCORE_WEIGHTS,
  COMMERCIAL_SCORING_MODEL_VERSION,
  type CommercialAiAnalysis,
  type CommercialScoreDimension,
} from "./discovery-contract.ts";

export type CommercialScoringInput = {
  analysis: CommercialAiAnalysis;
  isPrivate: boolean | null;
  profileFound: boolean;
  businessStatus: "unknown" | "open" | "closed";
  deterministicLocationConfidence?: "HIGH" | "MEDIUM" | "LOW";
};

export type CommercialScoringResult = {
  score: number;
  scorePercent: number;
  scorePriority: "P1" | "P2" | "P3";
  crmPriority: "urgent" | "high" | "normal" | "low";
  qualificationStatus: "qualified" | "enriched" | "not_qualified";
  itemStatus: "created" | "hard_rejected";
  needsManualReview: boolean;
  hardGateCodes: string[];
  scoringModelVersion: typeof COMMERCIAL_SCORING_MODEL_VERSION;
  breakdown: Record<CommercialScoreDimension, { value: number; weight: number; contribution: number }>;
};

function clamp(value: number, min = 0, max = 10) {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

export function scoreCommercialProspect(input: CommercialScoringInput): CommercialScoringResult {
  const breakdown = Object.fromEntries(Object.entries(COMMERCIAL_SCORE_WEIGHTS).map(([key, weight]) => {
    const value = clamp(input.analysis.dimensions[key as CommercialScoreDimension]);
    return [key, { value, weight, contribution: Number((value * weight).toFixed(3)) }];
  })) as CommercialScoringResult["breakdown"];
  const rawScore = Object.values(breakdown).reduce((sum, row) => sum + row.contribution, 0);
  const hardGateCodes = [
    ...(!input.profileFound ? ["profile_not_found"] : []),
    ...(input.isPrivate === true ? ["instagram_private"] : []),
    ...(input.businessStatus === "closed" || input.analysis.signals.appearsClosed ? ["business_closed"] : []),
    ...(!input.analysis.signals.isLocal || input.analysis.locationConfidence < 0.6 ? ["outside_strict_market"] : []),
    ...(!input.analysis.signals.isBeautyAesthetics || input.analysis.verticalConfidence < 0.6 ? ["wrong_vertical"] : []),
    ...(!input.analysis.signals.isCommerciallyActive ? ["no_commercial_activity"] : []),
  ];
  const hardRejected = hardGateCodes.length > 0;
  const confidencePenalty = input.analysis.confidence < 0.7 ? Math.min(1.5, (0.7 - input.analysis.confidence) * 5) : 0;
  const locationPenalty = input.deterministicLocationConfidence === "LOW" ? 2 : input.deterministicLocationConfidence === "MEDIUM" ? 0.4 : 0;
  const adjustedScore = clamp(rawScore - confidencePenalty - locationPenalty);
  const score = hardRejected ? 0 : Number((input.deterministicLocationConfidence === "LOW" ? Math.min(adjustedScore, 7.9) : adjustedScore).toFixed(1));
  const scorePriority = score >= 8 ? "P1" : score >= 6.5 ? "P2" : "P3";
  const needsManualReview = !hardRejected && input.deterministicLocationConfidence !== "LOW" && ((scorePriority === "P1" && input.analysis.confidence >= 0.72)
    || (scorePriority === "P2" && score >= 7.2 && input.analysis.confidence >= 0.8));
  return {
    score,
    scorePercent: Math.round(score * 10),
    scorePriority,
    crmPriority: scorePriority === "P1" ? "urgent" : scorePriority === "P2" ? "high" : score >= 5 ? "normal" : "low",
    qualificationStatus: hardRejected ? "not_qualified" : needsManualReview ? "qualified" : "enriched",
    itemStatus: hardRejected ? "hard_rejected" : "created",
    needsManualReview,
    hardGateCodes,
    scoringModelVersion: COMMERCIAL_SCORING_MODEL_VERSION,
    breakdown,
  };
}
