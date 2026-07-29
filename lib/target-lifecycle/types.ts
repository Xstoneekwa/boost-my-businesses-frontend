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
  | "premium_archive_deferred_until_replacement"
  | TargetAvailabilityReason;

export type TargetAvailabilityStatus =
  | "available"
  | "username_changed"
  | "verified_restricted"
  | "temporarily_unavailable"
  | "permanently_unavailable"
  | "lookup_failed"
  | "followers_surface_restricted"
  | "suspended_or_disabled"
  | "deleted_or_not_found"
  | "identity_conflict"
  | "stale_evidence"
  | "insufficient_evidence"
  | "availability_unknown";

export type TargetAvailabilityConfidence = "unknown" | "low" | "medium" | "high";

export type TargetAvailabilityReason =
  | "target_available"
  | "target_username_changed"
  | "target_identity_match_confirmed"
  | "target_identity_conflict"
  | "target_previous_username_reassigned"
  | "target_profile_not_found"
  | "target_temporarily_unavailable"
  | "target_permanently_unavailable"
  | "target_suspended_or_disabled"
  | "target_lookup_failed"
  | "target_availability_unknown"
  | "target_availability_recheck_required"
  | "target_verified_status_detected"
  | "target_became_verified"
  | "target_verified_followers_surface_restricted"
  | "target_followers_surface_terminally_limited"
  | "accessible_audience_surface_insufficient"
  | "target_navigation_retry_budget_exhausted"
  | "target_source_profile_resolution_failed"
  | "target_followers_entry_failed"
  | "target_quarantined_for_availability_review";

export type TargetAvailabilityEvidenceSource = "worker" | "provider" | "operator" | "synthetic";
export type TargetFollowersSurfaceState = "normal" | "restricted" | "terminally_limited" | "unknown";
export type TargetLookupResult = "found" | "not_found" | "unavailable" | "failed" | "unknown";

export interface TargetAvailabilityEvidence {
  evidenceId: string;
  observedAt: string;
  source: TargetAvailabilityEvidenceSource;
  runId?: string | null;
  deviceId?: string | null;
  searchedUsername: string;
  observedUsername?: string | null;
  observedStablePlatformUserId?: string | null;
  lookupResult: TargetLookupResult;
  profileFound?: boolean | null;
  verifiedBadge?: boolean | null;
  followersSurface: TargetFollowersSurfaceState;
  accessibleProfilesCount?: number | null;
  terminalEndDetected?: boolean;
  repeatedProfilesDetected?: boolean;
  networkHealthy?: boolean | null;
  sessionHealthy?: boolean | null;
  uiEvidenceQuality?: "unknown" | "low" | "medium" | "high";
  instagramVersion?: string | null;
  workerVersion?: string | null;
}

export interface TargetIdentityResolution {
  status: "unchanged" | "matched_rename" | "conflict" | "unresolved";
  stablePlatformUserId: string | null;
  previousUsername: string | null;
  resolvedUsername: string | null;
  automaticUsernameUpdateAllowed: boolean;
  reasons: readonly TargetAvailabilityReason[];
}

export interface TargetUsernameChangeAssessment {
  changed: boolean;
  previousUsername: string;
  observedUsername: string | null;
  identityMatch: boolean;
  previousUsernameReassigned: boolean;
  operatorConfirmationRequired: boolean;
}

export interface TargetAvailabilityAssessment {
  scope: TargetLifecycleScope & { stablePlatformUserId: string | null };
  status: TargetAvailabilityStatus;
  confidence: TargetAvailabilityConfidence;
  reasons: readonly TargetAvailabilityReason[];
  identityResolution: TargetIdentityResolution;
  usernameChange: TargetUsernameChangeAssessment;
  evidenceCount: number;
  distinctRunCount: number;
  distinctDeviceCount: number;
  latestObservedAt: string | null;
  recheckRequired: boolean;
  quarantineRecommended: boolean;
  replacementRequired: boolean;
  terminalProof: boolean;
  calculatedAt: string;
}

export interface TargetAvailabilityAssessmentInput extends TargetLifecycleScope {
  stablePlatformUserId?: string | null;
  evidence: readonly TargetAvailabilityEvidence[];
  calculatedAt: string;
  staleAfterDays?: number;
}

export interface TargetAvailabilityTransition {
  from: TargetAvailabilityStatus;
  to: TargetAvailabilityStatus;
  allowed: boolean;
  reason: TargetAvailabilityReason;
}

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
  availability: TargetAvailabilityAssessment | null;
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
  availability?: TargetAvailabilityAssessment | null;
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
  | "resolve_target_identity"
  | "recheck_availability"
  | "quarantine_target"
  | "hold_for_operator"
  | "block_due_to_insufficient_data";

export interface TargetPlanPolicyInput {
  plan: TargetPlan;
  assessment: TargetLifecycleAssessment;
  eligibleTargetCount: number;
  minimumEligibleTargetCount: number;
  onboardingComplete: boolean;
  replacementState: TargetReplacementState;
  availabilityAssessment?: TargetAvailabilityAssessment | null;
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
