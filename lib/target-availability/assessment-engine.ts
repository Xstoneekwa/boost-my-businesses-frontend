import {
  TARGET_AVAILABILITY_ENGINE_REVISION,
  TARGET_AVAILABILITY_ENGINE_VERSION,
  TARGET_AVAILABILITY_FRESHNESS,
  TARGET_AVAILABILITY_POLICY_REVISION,
  TARGET_AVAILABILITY_POLICY_VERSION,
  TARGET_AVAILABILITY_RULE_VERSION,
  TARGET_AVAILABILITY_SIGNAL_RULES,
} from "./engine-policy.ts";
import type {
  AvailabilityAssessment,
  AvailabilityConfidence,
  AvailabilityObservation,
  AvailabilityScope,
  AvailabilitySignal,
  AvailabilityStatus,
  EngineEvent,
  IdentityCurrent,
} from "./engine-types.ts";
import { deterministicUuid, event, orderAndValidateObservations, timestamp } from "./engine-utils.ts";

const distinctRuns = (rows: readonly AvailabilityObservation[]) =>
  new Set(rows.map((row) => row.runId || row.observationId)).size;

const latestAt = (rows: readonly AvailabilityObservation[]) => rows.at(-1)?.observedAt ?? null;

const after = (row: AvailabilityObservation, other: AvailabilityObservation | null) =>
  !other || timestamp(row.observedAt) > timestamp(other.observedAt);

const statusTtl = (status: AvailabilityStatus) => {
  if (["temporarily_unavailable", "unavailable_suspected", "verified_restricted_suspected"].includes(status)) {
    return TARGET_AVAILABILITY_FRESHNESS.temporaryAssessmentTtlMs;
  }
  if (["identity_ambiguous", "insufficient_evidence", "conflicting_evidence"].includes(status)) {
    return TARGET_AVAILABILITY_FRESHNESS.ambiguousAssessmentTtlMs;
  }
  return TARGET_AVAILABILITY_FRESHNESS.assessmentTtlMs;
};

const signalRows = (rows: readonly AvailabilityObservation[], ...signals: AvailabilitySignal[]) =>
  rows.filter((row) => signals.includes(row.signal));

function evaluateRepeat(rows: readonly AvailabilityObservation[], signal: AvailabilitySignal) {
  const rule = TARGET_AVAILABILITY_SIGNAL_RULES[signal];
  return rows.length >= rule.repeatRequired && distinctRuns(rows) >= rule.distinctRunsRequired;
}

export function assessAvailability(input: Readonly<{
  scope: AvailabilityScope;
  identity: IdentityCurrent;
  observations: readonly AvailabilityObservation[];
  assessedAt: string;
}>): Readonly<{ assessment: AvailabilityAssessment; events: readonly EngineEvent[]; rejectedObservationIds: readonly string[] }> {
  if (!input.scope.tenantId || !input.scope.accountId || !input.scope.targetId || !Number.isFinite(timestamp(input.assessedAt))) {
    throw new Error("target_availability_assessment_input_invalid");
  }
  if (input.identity.tenantId !== input.scope.tenantId || input.identity.accountId !== input.scope.accountId || input.identity.targetId !== input.scope.targetId) {
    throw new Error("target_availability_identity_scope_mismatch");
  }
  const checked = orderAndValidateObservations(input.scope, input.observations);
  const now = timestamp(input.assessedAt);
  const fresh: AvailabilityObservation[] = [];
  const expired: AvailabilityObservation[] = [];
  for (const row of checked.accepted) {
    const age = now - timestamp(row.observedAt);
    const ttl = TARGET_AVAILABILITY_SIGNAL_RULES[row.signal].ttlMs;
    if (!Number.isFinite(age) || age < 0 || age > ttl || row.signal === "stale_observation") expired.push(row);
    else fresh.push(row);
  }

  const available = signalRows(fresh, "profile_available");
  const unavailable = signalRows(fresh, "profile_unavailable");
  const deleted = signalRows(fresh, "account_deleted");
  const suspended = signalRows(fresh, "account_suspended");
  const banned = signalRows(fresh, "account_banned");
  const loginWall = signalRows(fresh, "login_wall");
  const accessRestricted = signalRows(fresh, "access_restricted");
  const temporaryErrors = signalRows(fresh, "temporary_instagram_error");
  const networkErrors = signalRows(fresh, "network_error");
  const uiInconsistency = signalRows(fresh, "ui_inconsistency");
  const insufficient = signalRows(fresh, "insufficient_evidence");
  const explicitIdentityConflict = signalRows(fresh, "identity_conflict", "ambiguous_identity");
  const badge = fresh.filter((row) => row.signal === "verified_badge_present" || row.verifiedBadge === true);
  const followersRestricted = fresh.filter((row) =>
    row.signal === "followers_surface_restricted"
    || row.signal === "verified_followers_restricted"
    || row.followersSurface === "restricted"
    || row.followersSurface === "terminally_limited");
  const verifiedRestrictedRows = followersRestricted.filter((row) => row.verifiedBadge === true || row.signal === "verified_followers_restricted");
  const latestAvailable = available.at(-1) ?? null;
  const latestNegative = [...unavailable, ...deleted, ...suspended, ...banned, ...loginWall, ...accessRestricted, ...temporaryErrors]
    .sort((left, right) => timestamp(left.observedAt) - timestamp(right.observedAt)).at(-1) ?? null;
  const recovered = Boolean(latestAvailable && after(latestAvailable, latestNegative));

  let status: AvailabilityStatus = "insufficient_evidence";
  let confidence: AvailabilityConfidence = "unknown";
  let contributors: AvailabilityObservation[] = [];
  let reasonCodes = ["availability_evidence_missing"];
  let explanation = ["No fresh decisive observation is available."];
  let missingEvidence = ["fresh_profile_or_terminal_evidence"];

  if (input.identity.identityStatus === "identity_conflict" || explicitIdentityConflict.some((row) => row.signal === "identity_conflict")) {
    status = "conflicting_evidence";
    confidence = "high";
    contributors = explicitIdentityConflict;
    reasonCodes = ["identity_conflict_fail_closed"];
    explanation = ["Conflicting identity evidence blocks any identity or availability mutation."];
    missingEvidence = ["operator_or_certified_stable_id_resolution"];
  } else if (input.identity.identityStatus === "username_change_confirmed") {
    status = "identity_changed";
    confidence = "high";
    contributors = signalRows(fresh, "username_changed");
    reasonCodes = ["username_change_stable_id_confirmed"];
    explanation = ["The same previously certified stable platform ID proves the username transition."];
    missingEvidence = [];
  } else if (["username_change_suspected", "identity_ambiguous"].includes(input.identity.identityStatus) || explicitIdentityConflict.length) {
    status = "identity_ambiguous";
    confidence = input.identity.confidence;
    contributors = explicitIdentityConflict.length ? explicitIdentityConflict : signalRows(fresh, "username_change_suspected");
    reasonCodes = ["identity_confirmation_required"];
    explanation = ["Username or identity evidence is insufficient for a canonical identity mutation."];
    missingEvidence = ["certified_stable_platform_user_id"];
  } else if (badge.length > 0 && verifiedRestrictedRows.length > 0 && evaluateRepeat(verifiedRestrictedRows, "verified_followers_restricted") && !recovered) {
    status = "verified_restricted_confirmed";
    confidence = "high";
    contributors = [...badge, ...verifiedRestrictedRows];
    reasonCodes = ["verified_badge_and_followers_restriction_repeated"];
    explanation = ["Verified badge and followers restriction are fresh, coherent and repeated across distinct runs."];
    missingEvidence = [];
  } else if (badge.length > 0 && followersRestricted.length > 0 && !recovered) {
    status = "verified_restricted_suspected";
    confidence = "low";
    contributors = [...badge, ...followersRestricted];
    reasonCodes = ["verified_restriction_pending_confirmation"];
    explanation = ["Badge plus restriction was observed but repeat policy is not satisfied."];
    missingEvidence = ["second_fresh_distinct_run_restriction"];
  } else if (!recovered && ([...deleted, ...banned, ...suspended].some((row) =>
    evaluateRepeat(signalRows(fresh, row.signal), row.signal)))) {
    const terminalRows = [...deleted, ...banned, ...suspended];
    status = "unavailable_confirmed";
    confidence = "high";
    contributors = terminalRows;
    reasonCodes = ["terminal_unavailability_repeated"];
    explanation = ["A strong terminal signal meets its versioned repeat and distinct-run policy."];
    missingEvidence = [];
  } else if (!recovered && (deleted.length || banned.length || suspended.length || evaluateRepeat(unavailable, "profile_unavailable"))) {
    status = "unavailable_suspected";
    confidence = "medium";
    contributors = [...deleted, ...banned, ...suspended, ...unavailable];
    reasonCodes = ["unavailability_pending_confirmation"];
    explanation = ["Negative profile evidence is fresh but cannot yet confirm permanent unavailability."];
    missingEvidence = ["repeat_policy_or_strong_terminal_confirmation"];
  } else if (recovered || available.length) {
    status = recovered ? "available" : "likely_available";
    confidence = available.length >= 2 && distinctRuns(available) >= 2 ? "high" : "medium";
    contributors = available;
    reasonCodes = recovered ? ["profile_recovered_after_temporary_signal"] : ["profile_available_observed"];
    explanation = [recovered ? "A later healthy profile observation supersedes earlier temporary evidence." : "Fresh profile availability is observed."];
    missingEvidence = confidence === "high" ? [] : ["second_fresh_distinct_run_confirmation"];
  } else if (unavailable.length || loginWall.length || accessRestricted.length || temporaryErrors.length) {
    status = "temporarily_unavailable";
    confidence = "low";
    contributors = [...unavailable, ...loginWall, ...accessRestricted, ...temporaryErrors];
    reasonCodes = ["temporary_or_access_ambiguity"];
    explanation = ["Temporary, access, or incomplete negative evidence cannot prove permanent unavailability."];
    missingEvidence = ["healthy_session_recheck"];
  } else if (expired.length && !fresh.length) {
    status = "stale";
    confidence = "unknown";
    contributors = [];
    reasonCodes = ["all_observations_stale"];
    explanation = ["All accepted observations are outside their signal TTL."];
    missingEvidence = ["fresh_observation"];
  } else if (networkErrors.length || uiInconsistency.length || insufficient.length || badge.length || followersRestricted.length) {
    status = "insufficient_evidence";
    confidence = "low";
    contributors = [...networkErrors, ...uiInconsistency, ...insufficient, ...badge, ...followersRestricted];
    reasonCodes = ["non_decisive_or_ambiguous_evidence"];
    explanation = ["The evidence is observable but cannot establish target availability."];
    missingEvidence = ["fresh_healthy_profile_evidence"];
  }

  const contributorIds = [...new Set(contributors.map((row) => row.observationId))].sort();
  const ignoredIds = checked.accepted.filter((row) => !contributorIds.includes(row.observationId)).map((row) => row.observationId).sort();
  const evidenceTimes = contributors.map((row) => row.observedAt).sort((left, right) => timestamp(left) - timestamp(right));
  const lastEvidenceAt = evidenceTimes.at(-1) ?? null;
  const repeatCount = distinctRuns(contributors);
  const validUntil = new Date(now + statusTtl(status)).toISOString();
  const assessmentKeyPayload = {
    scope: input.scope,
    identity: input.identity,
    status,
    confidence,
    contributorIds,
    ignoredIds,
    repeatCount,
    reasonCodes,
    assessedAt: input.assessedAt,
    ruleVersion: TARGET_AVAILABILITY_RULE_VERSION,
    engineVersion: TARGET_AVAILABILITY_ENGINE_VERSION,
    policyVersion: TARGET_AVAILABILITY_POLICY_VERSION,
  };
  const assessmentId = deterministicUuid(assessmentKeyPayload);
  const assessment: AvailabilityAssessment = Object.freeze({
    ...input.scope,
    assessmentId,
    assessmentKey: `target-availability:${assessmentId}`,
    status,
    confidence,
    identityStatus: input.identity.identityStatus,
    contributingObservationIds: Object.freeze(contributorIds),
    ignoredObservationIds: Object.freeze(ignoredIds),
    repeatCount,
    ruleVersion: TARGET_AVAILABILITY_RULE_VERSION,
    engineVersion: TARGET_AVAILABILITY_ENGINE_VERSION,
    engineRevision: TARGET_AVAILABILITY_ENGINE_REVISION,
    policyRevision: TARGET_AVAILABILITY_POLICY_REVISION,
    reasonCodes: Object.freeze(reasonCodes),
    explanation: Object.freeze(explanation),
    missingEvidence: Object.freeze(missingEvidence),
    firstEvidenceAt: evidenceTimes.at(0) ?? null,
    lastEvidenceAt,
    validUntil,
    assessedAt: input.assessedAt,
  });
  const events: EngineEvent[] = [event(input.scope, "assessment_created", input.assessedAt, status, assessmentId)];
  events.push(...checked.rejected.map((item) => event(input.scope, "assessment_rejected", input.assessedAt, item.reason, item.observationId)));
  events.push(...checked.duplicateIds.map((id) => event(input.scope, "duplicate_observation_skipped", input.assessedAt, "idempotency_key_seen", id)));
  return Object.freeze({ assessment, events: Object.freeze(events), rejectedObservationIds: Object.freeze(checked.rejected.map((item) => item.observationId)) });
}
