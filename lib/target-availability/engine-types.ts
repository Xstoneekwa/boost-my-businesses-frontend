export type AvailabilityConfidence = "unknown" | "low" | "medium" | "high";

export type AvailabilitySignal =
  | "profile_available"
  | "profile_unavailable"
  | "account_deleted"
  | "account_suspended"
  | "account_banned"
  | "username_changed"
  | "username_change_suspected"
  | "login_wall"
  | "access_restricted"
  | "verified_badge_present"
  | "followers_surface_restricted"
  | "verified_followers_restricted"
  | "temporary_instagram_error"
  | "network_error"
  | "ui_inconsistency"
  | "identity_conflict"
  | "ambiguous_identity"
  | "stale_observation"
  | "insufficient_evidence";

export type IdentityStatus =
  | "identity_confirmed"
  | "identity_probable"
  | "username_change_suspected"
  | "username_change_confirmed"
  | "identity_conflict"
  | "identity_ambiguous"
  | "stable_id_missing"
  | "stale_identity"
  | "insufficient_identity_evidence";

export type AvailabilityStatus =
  | "available"
  | "likely_available"
  | "temporarily_unavailable"
  | "unavailable_suspected"
  | "unavailable_confirmed"
  | "identity_changed"
  | "identity_ambiguous"
  | "verified_restricted_suspected"
  | "verified_restricted_confirmed"
  | "stale"
  | "insufficient_evidence"
  | "conflicting_evidence";

export type AvailabilityScope = Readonly<{
  tenantId: string;
  accountId: string;
  targetId: string;
}>;

export type AvailabilityObservation = Readonly<AvailabilityScope & {
  observationId: string;
  idempotencyKey: string;
  signal: AvailabilitySignal;
  observedAt: string;
  source: "worker" | "provider" | "operator" | "synthetic";
  expectedUsername: string;
  observedUsername?: string | null;
  stablePlatformUserId?: string | null;
  profileRoute?: string | null;
  runId?: string | null;
  workerId?: string | null;
  confidence?: AvailabilityConfidence;
  verifiedBadge?: boolean | null;
  followersSurface?: "normal" | "restricted" | "terminally_limited" | "unknown";
  networkHealthy?: boolean | null;
  sessionHealthy?: boolean | null;
  uiEvidenceQuality?: "unknown" | "low" | "medium" | "high";
  reasonCodes?: readonly string[];
}>;

export type IdentityTransition = Readonly<AvailabilityScope & {
  transitionId: string;
  previousUsername: string;
  observedUsername: string | null;
  stablePlatformUserId: string | null;
  transitionType: IdentityStatus;
  confidence: AvailabilityConfidence;
  evidenceCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  sourceObservationIds: readonly string[];
  createdAt: string;
  ruleVersion: string;
  engineVersion: string;
}>;

export type IdentityCurrent = Readonly<AvailabilityScope & {
  canonicalUsername: string;
  observedUsername: string | null;
  stablePlatformUserId: string | null;
  identityStatus: IdentityStatus;
  confidence: AvailabilityConfidence;
  evidenceCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastConfirmedAt: string | null;
  staleAfter: string | null;
  sourceVersion: string;
  lastTransitionId: string | null;
  updatedAt: string;
}>;

export type IdentityResolutionResult = Readonly<{
  acceptedObservations: readonly AvailabilityObservation[];
  rejectedObservations: readonly Readonly<{ observationId: string; reason: string }>[];
  deduplicatedObservationIds: readonly string[];
  history: readonly IdentityTransition[];
  current: IdentityCurrent;
  observability: readonly EngineEvent[];
}>;

export type AvailabilityAssessment = Readonly<AvailabilityScope & {
  assessmentId: string;
  assessmentKey: string;
  status: AvailabilityStatus;
  confidence: AvailabilityConfidence;
  identityStatus: IdentityStatus;
  contributingObservationIds: readonly string[];
  ignoredObservationIds: readonly string[];
  repeatCount: number;
  ruleVersion: string;
  engineVersion: string;
  engineRevision: number;
  policyRevision: number;
  reasonCodes: readonly string[];
  explanation: readonly string[];
  missingEvidence: readonly string[];
  firstEvidenceAt: string | null;
  lastEvidenceAt: string | null;
  validUntil: string;
  assessedAt: string;
}>;

export type AvailabilityCurrent = Readonly<AvailabilityScope & {
  availabilityStatus: AvailabilityStatus;
  confidence: AvailabilityConfidence;
  identityStatus: IdentityStatus;
  latestAssessmentId: string;
  latestObservationAt: string | null;
  confirmedAt: string | null;
  validUntil: string;
  staleAfter: string;
  reasonCodes: readonly string[];
  engineVersion: string;
  policyVersion: string;
  engineRevision: number;
  policyRevision: number;
  updatedAt: string;
}>;

export type CurrentProjectionResult = Readonly<{
  outcome: "inserted" | "updated" | "unchanged" | "skipped_stale_event" | "skipped_version_regression" | "rejected_scope";
  current: AvailabilityCurrent | null;
  events: readonly EngineEvent[];
}>;

export type EngineEventName =
  | "assessment_created"
  | "assessment_rejected"
  | "identity_transition_created"
  | "identity_conflict"
  | "current_updated"
  | "current_skipped_stale_event"
  | "duplicate_observation_skipped"
  | "replay_completed"
  | "invariant_violation";

export type EngineEvent = Readonly<AvailabilityScope & {
  type: EngineEventName;
  occurredAt: string;
  reason: string;
  subjectId?: string | null;
}>;

export type ReplayFixture = Readonly<{
  name: string;
  scope: AvailabilityScope;
  expectedUsername: string;
  stablePlatformUserId?: string | null;
  calculatedAt: string;
  observations: readonly AvailabilityObservation[];
  generatedObservationCount?: number;
  expected: Readonly<{
    identityStatus?: IdentityStatus;
    assessmentStatus?: AvailabilityStatus;
    currentStatus?: AvailabilityStatus;
    acceptedCount?: number;
    rejectedCount?: number;
    deduplicatedCount?: number;
  }>;
}>;

export type ReplayReport = Readonly<{
  fixtureName: string;
  inputs: number;
  eventsAccepted: number;
  eventsRejected: number;
  deduplicatedEvents: number;
  generatedTransitions: number;
  finalIdentity: IdentityCurrent;
  generatedAssessments: readonly AvailabilityAssessment[];
  finalAvailabilityCurrent: AvailabilityCurrent | null;
  invariantViolations: readonly string[];
  timingMs: Readonly<{ total: number; identity: number; assessment: number; current: number }>;
  events: readonly EngineEvent[];
}>;
