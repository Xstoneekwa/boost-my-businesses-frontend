import { TARGET_AVAILABILITY_POLICY_VERSION } from "./engine-policy.ts";
import type {
  AvailabilityAssessment,
  AvailabilityCurrent,
  AvailabilityScope,
  CurrentProjectionResult,
} from "./engine-types.ts";
import { event, sameScope, timestamp } from "./engine-utils.ts";

const confirmedStatuses = new Set([
  "available",
  "unavailable_confirmed",
  "identity_changed",
  "verified_restricted_confirmed",
  "conflicting_evidence",
]);

const buildCurrent = (assessment: AvailabilityAssessment): AvailabilityCurrent => Object.freeze({
  tenantId: assessment.tenantId,
  accountId: assessment.accountId,
  targetId: assessment.targetId,
  availabilityStatus: assessment.status,
  confidence: assessment.confidence,
  identityStatus: assessment.identityStatus,
  latestAssessmentId: assessment.assessmentId,
  latestObservationAt: assessment.lastEvidenceAt,
  confirmedAt: confirmedStatuses.has(assessment.status) && assessment.confidence === "high" ? assessment.assessedAt : null,
  validUntil: assessment.validUntil,
  staleAfter: assessment.validUntil,
  reasonCodes: assessment.reasonCodes,
  engineVersion: assessment.engineVersion,
  policyVersion: TARGET_AVAILABILITY_POLICY_VERSION,
  engineRevision: assessment.engineRevision,
  policyRevision: assessment.policyRevision,
  updatedAt: assessment.assessedAt,
});

const observationTime = (value: AvailabilityCurrent | AvailabilityAssessment) =>
  timestamp("latestObservationAt" in value ? value.latestObservationAt ?? value.updatedAt : value.lastEvidenceAt ?? value.assessedAt);

export function projectAvailabilityCurrent(input: Readonly<{
  scope: AvailabilityScope;
  previous: AvailabilityCurrent | null;
  assessment: AvailabilityAssessment;
}>): CurrentProjectionResult {
  const occurredAt = input.assessment.assessedAt;
  if (!sameScope(input.scope, input.assessment) || (input.previous && !sameScope(input.scope, input.previous))) {
    return Object.freeze({
      outcome: "rejected_scope",
      current: input.previous,
      events: Object.freeze([event(input.scope, "invariant_violation", occurredAt, "current_scope_mismatch", input.assessment.assessmentId)]),
    });
  }
  if (!input.previous) {
    const current = buildCurrent(input.assessment);
    return Object.freeze({
      outcome: "inserted",
      current,
      events: Object.freeze([event(input.scope, "current_updated", occurredAt, "initial_projection", input.assessment.assessmentId)]),
    });
  }
  if (input.previous.latestAssessmentId === input.assessment.assessmentId) {
    return Object.freeze({ outcome: "unchanged", current: input.previous, events: Object.freeze([]) });
  }
  const incomingVersion = [input.assessment.engineRevision, input.assessment.policyRevision];
  const currentVersion = [input.previous.engineRevision, input.previous.policyRevision];
  if (incomingVersion[0]! < currentVersion[0]! || (incomingVersion[0] === currentVersion[0] && incomingVersion[1]! < currentVersion[1]!)) {
    return Object.freeze({
      outcome: "skipped_version_regression",
      current: input.previous,
      events: Object.freeze([event(input.scope, "current_skipped_stale_event", occurredAt, "engine_or_policy_version_regression", input.assessment.assessmentId)]),
    });
  }
  const incomingObserved = observationTime(input.assessment);
  const currentObserved = observationTime(input.previous);
  const incomingAssessed = timestamp(input.assessment.assessedAt);
  const currentUpdated = timestamp(input.previous.updatedAt);
  const older = incomingObserved < currentObserved || (incomingObserved === currentObserved && incomingAssessed < currentUpdated);
  const concurrentLoses = incomingObserved === currentObserved
    && incomingAssessed === currentUpdated
    && input.assessment.assessmentId.localeCompare(input.previous.latestAssessmentId) < 0;
  if (older || concurrentLoses) {
    return Object.freeze({
      outcome: "skipped_stale_event",
      current: input.previous,
      events: Object.freeze([event(input.scope, "current_skipped_stale_event", occurredAt, concurrentLoses ? "concurrent_deterministic_winner_preserved" : "older_event", input.assessment.assessmentId)]),
    });
  }
  const current = buildCurrent(input.assessment);
  return Object.freeze({
    outcome: "updated",
    current,
    events: Object.freeze([event(input.scope, "current_updated", occurredAt, incomingVersion[0]! > currentVersion[0]! ? "engine_upgrade" : "newer_assessment", input.assessment.assessmentId)]),
  });
}

export function rebuildAvailabilityCurrent(scope: AvailabilityScope, assessments: readonly AvailabilityAssessment[]) {
  return [...assessments]
    .sort((left, right) =>
      timestamp(left.lastEvidenceAt ?? left.assessedAt) - timestamp(right.lastEvidenceAt ?? right.assessedAt)
      || timestamp(left.assessedAt) - timestamp(right.assessedAt)
      || left.assessmentId.localeCompare(right.assessmentId))
    .reduce<AvailabilityCurrent | null>((current, assessment) => projectAvailabilityCurrent({ scope, previous: current, assessment }).current, null);
}
