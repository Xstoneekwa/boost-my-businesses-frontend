import {
  TARGET_AVAILABILITY_ENGINE_VERSION,
  TARGET_AVAILABILITY_FRESHNESS,
  TARGET_AVAILABILITY_RULE_VERSION,
} from "./engine-policy.ts";
import type {
  AvailabilityConfidence,
  AvailabilityObservation,
  AvailabilityScope,
  IdentityCurrent,
  IdentityResolutionResult,
  IdentityStatus,
  IdentityTransition,
} from "./engine-types.ts";
import { deterministicUuid, event, normalizeUsername, orderAndValidateObservations, timestamp, validUsername } from "./engine-utils.ts";

const identitySignals = new Set(["profile_available", "username_changed", "username_change_suspected", "identity_conflict", "ambiguous_identity"]);

const distinct = (values: readonly (string | null | undefined)[]) => new Set(values.filter(Boolean)).size;

function transition(input: Readonly<{
  scope: AvailabilityScope;
  previousUsername: string;
  observedUsername: string | null;
  stableId: string | null;
  status: IdentityStatus;
  confidence: AvailabilityConfidence;
  rows: readonly AvailabilityObservation[];
  createdAt: string;
}>): IdentityTransition {
  const first = input.rows.at(0)?.observedAt ?? input.createdAt;
  const last = input.rows.at(-1)?.observedAt ?? input.createdAt;
  const sourceIds = input.rows.map((row) => row.observationId);
  const body = {
    scope: input.scope,
    previousUsername: input.previousUsername,
    observedUsername: input.observedUsername,
    stableId: input.stableId,
    status: input.status,
    sourceIds,
    first,
    last,
    ruleVersion: TARGET_AVAILABILITY_RULE_VERSION,
    engineVersion: TARGET_AVAILABILITY_ENGINE_VERSION,
  };
  return Object.freeze({
    ...input.scope,
    transitionId: deterministicUuid(body),
    previousUsername: input.previousUsername,
    observedUsername: input.observedUsername,
    stablePlatformUserId: input.stableId,
    transitionType: input.status,
    confidence: input.confidence,
    evidenceCount: input.rows.length,
    firstObservedAt: first,
    lastObservedAt: last,
    sourceObservationIds: Object.freeze(sourceIds),
    createdAt: input.createdAt,
    ruleVersion: TARGET_AVAILABILITY_RULE_VERSION,
    engineVersion: TARGET_AVAILABILITY_ENGINE_VERSION,
  });
}

export function resolveTargetIdentity(input: Readonly<{
  scope: AvailabilityScope;
  expectedUsername: string;
  stablePlatformUserId?: string | null;
  previousCurrent?: IdentityCurrent | null;
  observations: readonly AvailabilityObservation[];
  calculatedAt: string;
}>): IdentityResolutionResult {
  const canonical = normalizeUsername(input.previousCurrent?.canonicalUsername ?? input.expectedUsername);
  if (!input.scope.tenantId || !input.scope.accountId || !input.scope.targetId || !validUsername(canonical) || !Number.isFinite(timestamp(input.calculatedAt))) {
    throw new Error("target_availability_identity_input_invalid");
  }
  const checked = orderAndValidateObservations(input.scope, input.observations);
  const rows = checked.accepted.filter((row) => identitySignals.has(row.signal));
  const storedStableId = (input.previousCurrent?.stablePlatformUserId ?? input.stablePlatformUserId)?.trim() || null;
  const explicitConflicts = rows.filter((row) => row.signal === "identity_conflict");
  const differentStableIds = rows.filter((row) => storedStableId && row.stablePlatformUserId && row.stablePlatformUserId !== storedStableId);
  const matchedSameUsername = rows.filter((row) => normalizeUsername(row.observedUsername ?? row.expectedUsername) === canonical);
  const renamed = rows.filter((row) => {
    const observed = normalizeUsername(row.observedUsername);
    return Boolean(observed && observed !== canonical);
  });
  const stableRename = renamed.filter((row) => storedStableId && row.stablePlatformUserId === storedStableId);
  const renameRuns = distinct(renamed.map((row) => row.runId ?? row.observationId));
  const adoptedStableId = storedStableId ?? matchedSameUsername.find((row) => row.stablePlatformUserId)?.stablePlatformUserId?.trim() ?? null;

  let status: IdentityStatus = "insufficient_identity_evidence";
  let confidence: AvailabilityConfidence = "unknown";
  let observedUsername: string | null = null;
  let confirmedAt: string | null = input.previousCurrent?.lastConfirmedAt ?? null;
  let stableId = adoptedStableId;
  let contributors: readonly AvailabilityObservation[] = rows;

  if (explicitConflicts.length || differentStableIds.length) {
    status = "identity_conflict";
    confidence = "high";
    stableId = storedStableId;
    contributors = [...explicitConflicts, ...differentStableIds];
  } else if (stableRename.length) {
    status = "username_change_confirmed";
    confidence = "high";
    observedUsername = normalizeUsername(stableRename.at(-1)?.observedUsername);
    confirmedAt = stableRename.at(-1)?.observedAt ?? null;
    contributors = stableRename;
  } else if (renamed.length && renameRuns >= 2) {
    status = storedStableId ? "identity_ambiguous" : "username_change_suspected";
    confidence = "medium";
    observedUsername = normalizeUsername(renamed.at(-1)?.observedUsername);
    contributors = renamed;
  } else if (renamed.length) {
    status = "identity_ambiguous";
    confidence = "low";
    observedUsername = normalizeUsername(renamed.at(-1)?.observedUsername);
    contributors = renamed;
  } else if (matchedSameUsername.length) {
    status = adoptedStableId ? "identity_confirmed" : "stable_id_missing";
    confidence = adoptedStableId ? "high" : "medium";
    observedUsername = canonical;
    confirmedAt = matchedSameUsername.at(-1)?.observedAt ?? null;
    contributors = matchedSameUsername;
  } else if (!storedStableId && rows.length) {
    status = "stable_id_missing";
    confidence = "low";
  }

  const lastSeenAt = checked.accepted.at(-1)?.observedAt ?? input.previousCurrent?.lastSeenAt ?? null;
  if (lastSeenAt && timestamp(input.calculatedAt) - timestamp(lastSeenAt) > TARGET_AVAILABILITY_FRESHNESS.identityStaleAfterMs) {
    status = "stale_identity";
    confidence = "low";
  }
  const firstSeenAt = input.previousCurrent?.firstSeenAt ?? checked.accepted.at(0)?.observedAt ?? null;
  const staleAfter = lastSeenAt ? new Date(timestamp(lastSeenAt) + TARGET_AVAILABILITY_FRESHNESS.identityStaleAfterMs).toISOString() : null;
  const history = contributors.length ? [transition({
    scope: input.scope,
    previousUsername: canonical,
    observedUsername,
    stableId,
    status,
    confidence,
    rows: contributors,
    createdAt: input.calculatedAt,
  })] : [];
  const current: IdentityCurrent = Object.freeze({
    ...input.scope,
    canonicalUsername: status === "username_change_confirmed" && observedUsername ? observedUsername : canonical,
    observedUsername,
    stablePlatformUserId: stableId,
    identityStatus: status,
    confidence,
    evidenceCount: checked.accepted.length,
    firstSeenAt,
    lastSeenAt,
    lastConfirmedAt: confirmedAt,
    staleAfter,
    sourceVersion: `${TARGET_AVAILABILITY_ENGINE_VERSION}:${TARGET_AVAILABILITY_RULE_VERSION}`,
    lastTransitionId: history.at(-1)?.transitionId ?? input.previousCurrent?.lastTransitionId ?? null,
    updatedAt: input.calculatedAt,
  });
  const observability = [
    ...checked.duplicateIds.map((id) => event(input.scope, "duplicate_observation_skipped", input.calculatedAt, "idempotency_key_seen", id)),
    ...history.map((item) => event(input.scope, item.transitionType === "identity_conflict" ? "identity_conflict" : "identity_transition_created", input.calculatedAt, item.transitionType, item.transitionId)),
    ...checked.rejected.map((item) => event(input.scope, "invariant_violation", input.calculatedAt, item.reason, item.observationId)),
  ];
  return Object.freeze({
    acceptedObservations: checked.accepted,
    rejectedObservations: checked.rejected,
    deduplicatedObservationIds: checked.duplicateIds,
    history: Object.freeze(history),
    current,
    observability: Object.freeze(observability),
  });
}
