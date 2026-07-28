import type {
  TargetAvailabilityAssessment,
  TargetAvailabilityAssessmentInput,
  TargetAvailabilityConfidence,
  TargetAvailabilityEvidence,
  TargetAvailabilityReason,
  TargetAvailabilityStatus,
  TargetAvailabilityTransition,
  TargetIdentityResolution,
} from "./types.ts";

const normalizeUsername = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/^@+/, "").toLowerCase();

const safeDate = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const evidenceQuality = (evidence: TargetAvailabilityEvidence) => {
  if (evidence.uiEvidenceQuality === "high") return 3;
  if (evidence.uiEvidenceQuality === "medium") return 2;
  if (evidence.uiEvidenceQuality === "low") return 1;
  return 0;
};

const distinct = (values: readonly (string | null | undefined)[]) =>
  new Set(values.filter((value): value is string => Boolean(value))).size;

function confidenceFor(input: {
  evidenceCount: number;
  distinctRuns: number;
  distinctDevices: number;
  networkHealthyCount: number;
  highQualityCount: number;
  terminalProof: boolean;
  identityProof: boolean;
}): TargetAvailabilityConfidence {
  if (input.terminalProof || input.identityProof) return "high";
  if (input.evidenceCount >= 3 && input.distinctRuns >= 2 && input.networkHealthyCount >= 2 && input.highQualityCount >= 2) {
    return "high";
  }
  if (input.evidenceCount >= 2 && (input.distinctRuns >= 2 || input.highQualityCount >= 1)) return "medium";
  if (input.evidenceCount >= 1) return "low";
  return "unknown";
}

function resolveIdentity(
  input: TargetAvailabilityAssessmentInput,
  evidence: readonly TargetAvailabilityEvidence[],
): TargetIdentityResolution {
  const storedUsername = normalizeUsername(input.normalizedUsername);
  const storedId = input.stablePlatformUserId?.trim() || null;
  const found = evidence.filter((item) => item.lookupResult === "found" || item.profileFound === true);
  const conflictingAtOldUsername = found.some((item) =>
    normalizeUsername(item.observedUsername || item.searchedUsername) === storedUsername
    && Boolean(storedId && item.observedStablePlatformUserId && item.observedStablePlatformUserId !== storedId));
  if (conflictingAtOldUsername) {
    return Object.freeze({
      status: "conflict",
      stablePlatformUserId: storedId,
      previousUsername: storedUsername,
      resolvedUsername: null,
      automaticUsernameUpdateAllowed: false,
      reasons: Object.freeze<TargetAvailabilityReason[]>(["target_previous_username_reassigned", "target_identity_conflict"]),
    });
  }

  const renamedMatch = found.find((item) => {
    const observed = normalizeUsername(item.observedUsername);
    return Boolean(storedId && item.observedStablePlatformUserId === storedId && observed && observed !== storedUsername);
  });
  if (renamedMatch) {
    return Object.freeze({
      status: "matched_rename",
      stablePlatformUserId: storedId,
      previousUsername: storedUsername,
      resolvedUsername: normalizeUsername(renamedMatch.observedUsername),
      automaticUsernameUpdateAllowed: true,
      reasons: Object.freeze<TargetAvailabilityReason[]>(["target_username_changed", "target_identity_match_confirmed"]),
    });
  }

  const conflictingId = found.some((item) =>
    Boolean(storedId && item.observedStablePlatformUserId && item.observedStablePlatformUserId !== storedId));
  if (conflictingId) {
    return Object.freeze({
      status: "conflict",
      stablePlatformUserId: storedId,
      previousUsername: storedUsername,
      resolvedUsername: null,
      automaticUsernameUpdateAllowed: false,
      reasons: Object.freeze<TargetAvailabilityReason[]>(["target_identity_conflict"]),
    });
  }

  const unchanged = found.some((item) =>
    normalizeUsername(item.observedUsername || item.searchedUsername) === storedUsername
    && (!storedId || !item.observedStablePlatformUserId || item.observedStablePlatformUserId === storedId));
  return Object.freeze({
    status: unchanged ? "unchanged" : "unresolved",
    stablePlatformUserId: storedId,
    previousUsername: storedUsername,
    resolvedUsername: unchanged ? storedUsername : null,
    automaticUsernameUpdateAllowed: false,
    reasons: Object.freeze<TargetAvailabilityReason[]>(
      unchanged ? [] : ["target_availability_recheck_required"],
    ),
  });
}

export function assessTargetAvailability(input: TargetAvailabilityAssessmentInput): TargetAvailabilityAssessment {
  const evidence = [...input.evidence].sort((a, b) => safeDate(a.observedAt) - safeDate(b.observedAt));
  const latest = evidence.at(-1) ?? null;
  const latestAt = latest?.observedAt ?? null;
  const ageMs = latestAt ? safeDate(input.calculatedAt) - safeDate(latestAt) : Number.NaN;
  const stale = evidence.length > 0 && (!Number.isFinite(ageMs) || ageMs < 0
    || ageMs > (input.staleAfterDays ?? 14) * 86_400_000);
  const identity = resolveIdentity(input, evidence);
  const found = evidence.filter((item) => item.lookupResult === "found" || item.profileFound === true);
  const notFound = evidence.filter((item) => item.lookupResult === "not_found" || item.profileFound === false);
  const lookupFailures = evidence.filter((item) => ["failed", "unavailable"].includes(item.lookupResult));
  const healthyNotFound = notFound.filter((item) => item.networkHealthy === true && item.sessionHealthy !== false);
  const verified = found.filter((item) => item.verifiedBadge === true);
  const restricted = evidence.filter((item) => ["restricted", "terminally_limited"].includes(item.followersSurface));
  const terminalRestricted = restricted.filter((item) =>
    item.followersSurface === "terminally_limited"
    && item.terminalEndDetected === true
    && item.networkHealthy === true
    && item.sessionHealthy !== false
    && evidenceQuality(item) >= 2);
  const repeatedRestricted = restricted.length >= 2
    && distinct(restricted.map((item) => item.runId || item.evidenceId)) >= 2
    && restricted.filter((item) => item.networkHealthy === true).length >= 2;
  const verifiedRestricted = verified.length > 0 && (terminalRestricted.length > 0 || repeatedRestricted);
  const terminalAbsence = healthyNotFound.length >= 3
    && distinct(healthyNotFound.map((item) => item.runId || item.evidenceId)) >= 2
    && healthyNotFound.some((item) => evidenceQuality(item) >= 2);
  const terminalProof = verifiedRestricted && terminalRestricted.length > 0 || terminalAbsence;
  const identityProof = identity.status === "matched_rename" || identity.status === "conflict";
  const confidence = confidenceFor({
    evidenceCount: evidence.length,
    distinctRuns: distinct(evidence.map((item) => item.runId)),
    distinctDevices: distinct(evidence.map((item) => item.deviceId)),
    networkHealthyCount: evidence.filter((item) => item.networkHealthy === true).length,
    highQualityCount: evidence.filter((item) => evidenceQuality(item) >= 2).length,
    terminalProof,
    identityProof,
  });

  let status: TargetAvailabilityStatus = "availability_unknown";
  let reasons: TargetAvailabilityReason[] = ["target_availability_unknown"];
  if (!evidence.length) [status, reasons] = ["insufficient_evidence", ["target_availability_unknown"]];
  else if (stale) [status, reasons] = ["stale_evidence", ["target_availability_recheck_required"]];
  else if (identity.status === "conflict") [status, reasons] = ["identity_conflict", [...identity.reasons]];
  else if (identity.status === "matched_rename") [status, reasons] = ["username_changed", [...identity.reasons]];
  else if (verifiedRestricted) {
    [status, reasons] = ["verified_restricted", [
      "target_verified_status_detected",
      "target_verified_followers_surface_restricted",
      ...(terminalRestricted.length ? ["target_followers_surface_terminally_limited" as const] : []),
      "target_accessible_audience_insufficient",
    ]];
  } else if (terminalAbsence) {
    [status, reasons] = ["deleted_or_not_found", ["target_profile_not_found", "target_permanently_unavailable"]];
  } else if (verified.length > 0 && restricted.length === 0) {
    [status, reasons] = ["available", ["target_verified_status_detected"]];
  } else if (restricted.length > 0) {
    [status, reasons] = ["followers_surface_restricted", [
      "target_followers_entry_failed",
      "target_availability_recheck_required",
    ]];
  } else if (lookupFailures.length > 0 && lookupFailures.every((item) => item.networkHealthy === false)) {
    [status, reasons] = ["lookup_failed", ["target_lookup_failed", "target_availability_recheck_required"]];
  } else if (notFound.length > 0 || lookupFailures.length > 0) {
    [status, reasons] = ["temporarily_unavailable", [
      "target_temporarily_unavailable",
      "target_availability_recheck_required",
    ]];
  } else if (found.length > 0 && latest?.followersSurface === "normal") {
    [status, reasons] = ["available", []];
  }

  const replacementRequired = ["verified_restricted", "permanently_unavailable", "deleted_or_not_found"].includes(status);
  const recheckRequired = [
    "temporarily_unavailable",
    "lookup_failed",
    "followers_surface_restricted",
    "suspended_or_disabled",
    "stale_evidence",
    "insufficient_evidence",
    "availability_unknown",
  ].includes(status);
  const quarantineRecommended = recheckRequired || status === "identity_conflict";
  return Object.freeze({
    scope: Object.freeze({
      tenantId: input.tenantId,
      accountId: input.accountId,
      targetId: input.targetId,
      normalizedUsername: normalizeUsername(input.normalizedUsername),
      stablePlatformUserId: input.stablePlatformUserId?.trim() || null,
    }),
    status,
    confidence,
    reasons: Object.freeze(reasons),
    identityResolution: identity,
    usernameChange: Object.freeze({
      changed: identity.status === "matched_rename",
      previousUsername: normalizeUsername(input.normalizedUsername),
      observedUsername: identity.resolvedUsername,
      identityMatch: identity.status === "matched_rename",
      previousUsernameReassigned: identity.reasons.includes("target_previous_username_reassigned"),
      operatorConfirmationRequired: identity.status === "conflict",
    }),
    evidenceCount: evidence.length,
    distinctRunCount: distinct(evidence.map((item) => item.runId)),
    distinctDeviceCount: distinct(evidence.map((item) => item.deviceId)),
    latestObservedAt: latestAt,
    recheckRequired,
    quarantineRecommended,
    replacementRequired,
    terminalProof,
    calculatedAt: input.calculatedAt,
  });
}

export function recommendTargetAvailabilityTransition(
  from: TargetAvailabilityStatus,
  assessment: TargetAvailabilityAssessment,
): TargetAvailabilityTransition {
  const terminal = new Set<TargetAvailabilityStatus>(["permanently_unavailable", "deleted_or_not_found"]);
  const allowed = !terminal.has(from) || terminal.has(assessment.status) || assessment.status === "available";
  return Object.freeze({
    from,
    to: allowed ? assessment.status : from,
    allowed,
    reason: assessment.reasons[0] ?? "target_availability_unknown",
  });
}
