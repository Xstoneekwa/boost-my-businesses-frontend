export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type TenantId = Brand<string, "TenantId">;
export type AccountId = Brand<string, "AccountId">;
export type BatchId = Brand<string, "BatchId">;
export type ProposalId = Brand<string, "ProposalId">;
export type SnapshotId = Brand<string, "SnapshotId">;
export type TargetId = Brand<string, "TargetId">;

export type CtPlan = "growth" | "pro" | "premium";
export type CtBatchStatus =
  | "preparing"
  | "ready_for_review"
  | "partially_reviewed"
  | "review_expired"
  | "auto_validation_pending"
  | "activating"
  | "completed"
  | "frozen"
  | "canceled"
  | "failed";
export type CtProposalStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "auto_accepted"
  | "invalidated"
  | "activation_pending"
  | "activated"
  | "activation_failed";
export type CtDecisionSource = "client" | "system_timeout" | "operator" | "system_revalidation";
export type CtProposalOutcome =
  | "accepted"
  | "rejected"
  | "auto_accepted"
  | "invalidated"
  | "activated"
  | "activation_failed"
  | "frozen"
  | "canceled";
export type CtDomainErrorCode =
  | "premium_required"
  | "account_not_owned"
  | "account_paused"
  | "account_canceled"
  | "campaign_blocked"
  | "review_expired"
  | "batch_frozen"
  | "batch_canceled"
  | "proposal_not_pending"
  | "cross_account_access"
  | "revalidation_failed"
  | "activation_blocked"
  | "idempotency_conflict"
  | "stock_above_trigger"
  | "account_not_found"
  | "lifecycle_incompatible"
  | "invalid_transition";
export type CtExclusionReasonCode =
  | "invalid_username"
  | "duplicate_in_batch"
  | "duplicate_active_target"
  | "duplicate_active_proposal"
  | "blacklisted"
  | "missing_profile_data"
  | "profile_not_eligible"
  | "score_below_threshold";

export interface CtClock { now(): Date }
export interface CtIdGenerator {
  next(kind: "batch" | "proposal" | "snapshot" | "target"): string;
}

export interface CtCommercialState {
  plan: CtPlan;
  premiumEntitlementActive: boolean;
  entitlementId: string | null;
  entitlementExpiresAt: string | null;
}

export interface CtAccountRuntimeState {
  exists: boolean;
  ownershipActive: boolean;
  paused: boolean;
  canceled: boolean;
  campaignBlocked: boolean;
  lifecycleCompatible: boolean;
  eligibleTargetCount: number;
}

export interface CtReviewWindow {
  startedAt: string;
  expiresAt: string;
  durationDays: 5;
}

export interface CtTargetPerformance {
  username: string;
  follows: number;
  followbacks: number;
}

export interface CtTargetingCriteriaSnapshot {
  id: SnapshotId;
  tenantId: TenantId;
  accountId: AccountId;
  plan: CtPlan;
  entitlementIdentity: string;
  entitlementVersion: string;
  eligibleTargetCount: number;
  accountLanguage: string;
  targetGeographies: readonly string[];
  targetLanguages: readonly string[];
  categories: readonly string[];
  followerRange: Readonly<{ min: number; max: number }>;
  engagementExpectation: number;
  accountAnalysis: Readonly<Record<string, string | number | boolean | null>>;
  activeTargetUsernames: readonly string[];
  historicalTargetPerformance: readonly CtTargetPerformance[];
  sourceTargetPerformance: Readonly<Record<string, number>>;
  followbackSignals: Readonly<Record<string, number>>;
  skipEligibilitySignals: Readonly<Record<string, string | number | boolean | null>>;
  blacklistUsernames: readonly string[];
  reviewConfig: Readonly<{ durationDays: 5; rejectedCooldownDays: number }>;
  scoringVersion: string;
  searchStrategyVersion: string;
  batchSize: number;
  triggerReason: string;
  createdAt: string;
  fingerprint: string;
}

export interface CtProposalCandidate {
  username: string;
  displayName?: string | null;
  biography?: string | null;
  followersCount?: number | null;
  language?: string | null;
  geography?: string | null;
  categories?: readonly string[];
  audienceMatch?: number;
  languageMatch?: number;
  geographyMatch?: number;
  categoryMatch?: number;
  followerRangeMatch?: number;
  engagementQuality?: number;
  profileActivity?: number;
  sourceTargetPerformance?: number;
  historicalFollowbackSignal?: number;
  profileEligibilityConfidence?: number;
  isEligible?: boolean;
}

export interface CtProposalScore {
  version: string;
  total: number;
  band: "reject" | "review" | "recommended";
  breakdown: Readonly<Record<string, number>>;
  positiveReasons: readonly string[];
  penalties: readonly string[];
  exclusionFlags: readonly string[];
}

export interface CtProposalDecision {
  source: CtDecisionSource;
  outcome: CtProposalOutcome;
  actorId: string;
  decidedAt: string;
  reasonCode: string;
}

export interface CtProposal {
  id: ProposalId;
  tenantId: TenantId;
  accountId: AccountId;
  batchId: BatchId;
  normalizedUsername: string;
  displayName: string | null;
  followersCount: number | null;
  score: CtProposalScore;
  status: CtProposalStatus;
  decision: CtProposalDecision | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CtProposalBatch {
  id: BatchId;
  tenantId: TenantId;
  accountId: AccountId;
  snapshotId: SnapshotId;
  entitlementId: string;
  status: CtBatchStatus;
  proposalIds: readonly ProposalId[];
  reviewWindow: CtReviewWindow | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  frozenReason: string | null;
}

export interface CtProposalEvent {
  type: string;
  tenantId: TenantId;
  accountId: AccountId;
  batchId: BatchId;
  proposalId?: ProposalId;
  actorId: string;
  source: CtDecisionSource;
  occurredAt: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CtEligibilityResult {
  eligible: boolean;
  reasons: readonly CtDomainErrorCode[];
}

export interface CtActivationEligibilityResult extends CtEligibilityResult {
  proposalId: ProposalId;
  normalizedUsername: string;
}

export interface CtBatchSummary {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  invalidated: number;
  activated: number;
  failed: number;
  complete: boolean;
}

export interface CtBatchActionAvailability {
  canAccept: boolean;
  canReject: boolean;
  canBulkAccept: boolean;
  canBulkReject: boolean;
  canEvaluateTimeout: boolean;
  readOnly: boolean;
  reasons: readonly CtDomainErrorCode[];
}

export interface CtScoringConfig {
  version: string;
  weights: Readonly<Record<CtScoringSignal, number>>;
  thresholds: Readonly<{ reject: number; recommended: number }>;
  missingProfilePenalty: number;
}

export type CtScoringSignal =
  | "audienceMatch"
  | "languageMatch"
  | "geographyMatch"
  | "categoryMatch"
  | "followerRangeMatch"
  | "engagementQuality"
  | "profileActivity"
  | "sourceTargetPerformance"
  | "historicalFollowbackSignal"
  | "profileEligibilityConfidence";

export interface CtBatchBuildConfig {
  maxProposals: number;
  scoring: CtScoringConfig;
}

export interface CtExcludedCandidate {
  username: string;
  normalizedUsername: string | null;
  reasons: readonly CtExclusionReasonCode[];
}

export interface CtBatchBuildResult {
  batch: CtProposalBatch | null;
  proposals: readonly CtProposal[];
  excluded: readonly CtExcludedCandidate[];
  events: readonly CtProposalEvent[];
  summary: CtBatchSummary;
  explanation: string;
  error: CtDomainErrorCode | null;
}

export interface CtRevalidationResult {
  proposalId: ProposalId;
  eligible: boolean;
  reasonCode: string;
}
