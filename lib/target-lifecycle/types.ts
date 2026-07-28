export type TargetLifecycleStatus =
  | "healthy"
  | "watch"
  | "replacement_recommended"
  | "replacement_pending"
  | "exhausted"
  | "archived"
  | "stale_data"
  | "insufficient_data";

export type TargetUtilizationConfidenceLevel = "low" | "medium" | "high";
export type TargetPlan = "growth" | "pro" | "premium";
export type TargetReplacementState = "none" | "recommended" | "pending" | "ready_for_review" | "activated";

export type TargetLifecycleReason =
  | "target_healthy"
  | "target_utilization_threshold_reached"
  | "target_replacement_recommended"
  | "target_replacement_pending"
  | "target_audience_exhausted"
  | "target_exploitable_audience_depleted"
  | "target_archived"
  | "target_utilization_data_insufficient"
  | "target_follower_count_stale"
  | "target_utilization_confidence_low"
  | "target_archived_after_replacement"
  | "target_archived_terminal_exhaustion"
  | "onboarding_incomplete"
  | "growth_client_target_request_required"
  | "pro_client_target_request_required"
  | "premium_automatic_replacement_required"
  | "premium_replacement_ready_for_review"
  | "premium_archive_deferred_until_replacement";

export interface TargetLifecycleScope {
  tenantId: string;
  accountId: string;
  targetId: string;
  normalizedUsername: string;
}

export interface TargetUtilizationBreakdown {
  followed: number | null;
  skipped: number | null;
  ineligible: number | null;
  unavailable: number | null;
  alreadyProcessed: number | null;
  duplicate: number | null;
  blacklisted: number | null;
}

export interface TargetAudienceDenominator {
  value: number | null;
  kind: "estimated_exploitable_audience" | "observed_follower_count" | "unavailable";
  version: string;
  source: string;
  observedAt: string | null;
  reliability: number;
}

export interface TargetUtilizationMetrics {
  uniqueProfilesEvaluated: number | null;
  breakdown: TargetUtilizationBreakdown;
  denominator: TargetAudienceDenominator;
  rawUtilizationRatio: number | null;
  utilizationRatio: number | null;
  minimumAbsoluteCount: number;
  followerCountIsFresh: boolean;
  followbackRatio: number | null;
  fbrBand: "unknown" | "low" | "average" | "good";
}

export interface TargetUtilizationConfidence {
  score: number;
  level: TargetUtilizationConfidenceLevel;
  factors: Readonly<{
    freshness: number;
    historicalCoverage: number;
    uniqueEvaluationCoverage: number;
    denominatorReliability: number;
    sourceAttributionReliability: number;
    workerVersionCoverage: number;
  }>;
  reasons: readonly TargetLifecycleReason[];
}

export interface TargetArchiveRecommendation {
  recommended: boolean;
  terminalProof: boolean;
  reason: "target_exploitable_audience_depleted" | null;
}

export interface TargetLifecycleAssessment {
  scope: TargetLifecycleScope;
  status: TargetLifecycleStatus;
  metrics: TargetUtilizationMetrics;
  confidence: TargetUtilizationConfidence;
  reasons: readonly TargetLifecycleReason[];
  archiveRecommendation: TargetArchiveRecommendation;
  thresholdVersion: string;
  calculatedAt: string;
}

export interface TargetLifecycleAssessmentInput extends TargetLifecycleScope {
  uniqueProfilesEvaluated: number | null;
  breakdown?: Partial<TargetUtilizationBreakdown>;
  estimatedExploitableAudience?: number | null;
  observedFollowerCount?: number | null;
  denominatorVersion?: string;
  denominatorSource?: string;
  denominatorObservedAt: string | null;
  denominatorReliability?: number;
  historicalCoverage: number;
  uniqueEvaluationCoverage?: number;
  sourceAttributionReliability?: number;
  workerVersionCoverage?: number;
  followbackRatio?: number | null;
  terminalProof?: boolean;
  archived?: boolean;
  replacementState?: TargetReplacementState;
  calculatedAt: string;
}

export interface TargetLifecycleTransition {
  from: TargetLifecycleStatus;
  to: TargetLifecycleStatus;
  allowed: boolean;
  reason: TargetLifecycleReason;
}

export interface TargetLifecycleEvent {
  type: "target_lifecycle_assessed" | "target_lifecycle_transition_recommended";
  scope: TargetLifecycleScope;
  status: TargetLifecycleStatus;
  occurredAt: string;
  reason: TargetLifecycleReason;
}

export type TargetPlanPolicyAction =
  | "no_action"
  | "monitor"
  | "recommend_replacement"
  | "mark_replacement_pending"
  | "request_client_targets"
  | "prepare_automatic_replacement"
  | "archive_after_replacement"
  | "archive_immediately_terminal"
  | "block_due_to_insufficient_data";

export interface TargetPlanPolicyInput {
  plan: TargetPlan;
  assessment: TargetLifecycleAssessment;
  eligibleTargetCount: number;
  minimumEligibleTargetCount: number;
  onboardingComplete: boolean;
  replacementState: TargetReplacementState;
  notificationState?: "not_sent" | "sent";
  evaluatedAt: string;
}

export interface TargetPlanPolicyDecision {
  plan: TargetPlan;
  action: TargetPlanPolicyAction;
  reasons: readonly TargetLifecycleReason[];
  automaticReplacementAllowed: boolean;
  replacementRequired: boolean;
  archiveAllowed: boolean;
  archiveDeferred: boolean;
  clientNotificationRequired: boolean;
  clientEmailRequired: boolean;
  lowStockRecomputeRequired: boolean;
  reasonCodes: readonly TargetLifecycleReason[];
  explanation: string;
  evaluatedAt: string;
}

export interface TargetAccountStock {
  tenantId: string;
  accountId: string;
  eligibleTargetCount: number;
  minimumEligibleTargetCount: number;
  lowStock: boolean;
  includedTargetIds: readonly string[];
  excludedTargetIds: readonly string[];
}
