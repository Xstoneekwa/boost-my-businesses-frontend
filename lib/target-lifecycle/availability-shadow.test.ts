import assert from "node:assert/strict";
import test from "node:test";
import { runTargetAvailabilityLocalShadow, type WorkerTargetAvailabilityObservation } from "./availability-shadow.ts";

const scope = {
  tenantId: "tenant-one",
  accountId: "account-one",
  targetId: "target-one",
  normalizedUsername: "target.one",
};
const now = "2026-07-29T12:00:00.000Z";

function observation(
  id: number,
  patch: Partial<WorkerTargetAvailabilityObservation> = {},
): WorkerTargetAvailabilityObservation {
  return {
    schema_version: "target-availability-observation-v1",
    observation_id: `tao_${id}`,
    idempotency_key: `target-availability:${id}`,
    event_key: `run-${id}:availability`,
    observed_at: `2026-07-29T10:${String(id).padStart(2, "0")}:00.000Z`,
    tenant_id: scope.tenantId,
    account_id: scope.accountId,
    target_id: scope.targetId,
    searched_username: scope.normalizedUsername,
    observed_username: scope.normalizedUsername,
    observed_stable_platform_user_id: "ig-100",
    run_id: `run-${id}`,
    device_key: "device-one",
    worker_version: "worker-shadow-v1",
    instagram_version: "instagram-test-v1",
    lookup_result: "found",
    profile_found: true,
    verified_badge: false,
    followers_surface: "normal",
    accessible_profiles_count: 200,
    terminal_end_detected: false,
    repeated_first_profiles_detected: false,
    retry_count: 0,
    retry_budget_exhausted: false,
    navigation_timeout: false,
    recovery_outcome: "not_attempted",
    ui_evidence_quality: "high",
    network_state: "healthy",
    session_state: "healthy",
    reason_codes: ["target_profile_found"],
    evidence_safe: {},
    ...patch,
  };
}

test("local shadow computes available without mutation", () => {
  const rows = Object.freeze([Object.freeze(observation(1))]);
  const before = JSON.stringify(rows);
  const report = runTargetAvailabilityLocalShadow({ scope, stablePlatformUserId: "ig-100", observations: rows, calculatedAt: now });
  assert.equal(report.assessment.status, "available");
  assert.equal(report.mutationExecuted, false);
  assert.equal(JSON.stringify(rows), before);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
});

test("local shadow confirms a stable-id username change", () => {
  const report = runTargetAvailabilityLocalShadow({
    scope,
    stablePlatformUserId: "ig-100",
    observations: [observation(2, { observed_username: "target.one.official" })],
    calculatedAt: now,
  });
  assert.equal(report.assessment.status, "username_changed");
  assert.equal(report.assessment.identityResolution.automaticUsernameUpdateAllowed, true);
});

test("verified badge alone is available and repeated restriction is verified_restricted", () => {
  const badgeOnly = runTargetAvailabilityLocalShadow({
    scope,
    stablePlatformUserId: "ig-100",
    observations: [observation(3, { verified_badge: true })],
    calculatedAt: now,
  });
  assert.equal(badgeOnly.assessment.status, "available");

  const restricted = (id: number) => observation(id, {
    verified_badge: true,
    followers_surface: "restricted",
    accessible_profiles_count: 50,
    repeated_first_profiles_detected: true,
  });
  const confirmed = runTargetAvailabilityLocalShadow({
    scope,
    stablePlatformUserId: "ig-100",
    observations: [restricted(4), restricted(5)],
    calculatedAt: now,
  });
  assert.equal(confirmed.assessment.status, "verified_restricted");
  assert.equal(confirmed.assessment.confidence, "medium");
});

test("one not-found is temporary and three healthy cross-run observations are terminal", () => {
  const missing = (id: number) => observation(id, {
    lookup_result: "not_found",
    profile_found: false,
    observed_username: null,
    observed_stable_platform_user_id: null,
    followers_surface: "unknown",
    reason_codes: ["target_profile_not_found"],
  });
  assert.equal(runTargetAvailabilityLocalShadow({ scope, observations: [missing(6)], calculatedAt: now }).assessment.status, "temporarily_unavailable");
  assert.equal(runTargetAvailabilityLocalShadow({ scope, observations: [missing(7), missing(8), missing(9)], calculatedAt: now }).assessment.status, "deleted_or_not_found");
});

test("network ambiguity remains lookup_failed with non-terminal confidence", () => {
  const failed = observation(10, {
    lookup_result: "failed",
    profile_found: null,
    observed_username: null,
    followers_surface: "unknown",
    network_state: "unavailable",
    ui_evidence_quality: "low",
    reason_codes: ["target_network_ambiguity"],
  });
  const report = runTargetAvailabilityLocalShadow({ scope, observations: [failed], calculatedAt: now });
  assert.equal(report.assessment.status, "lookup_failed");
  assert.equal(report.assessment.terminalProof, false);
  assert.equal(report.assessment.recheckRequired, true);
});

test("duplicates are idempotent and conflicting duplicates fail closed", () => {
  const row = observation(11);
  const report = runTargetAvailabilityLocalShadow({ scope, observations: [row, row], calculatedAt: now });
  assert.equal(report.acceptedObservationCount, 1);
  assert.equal(report.duplicateObservationCount, 1);
  assert.throws(() => runTargetAvailabilityLocalShadow({
    scope,
    observations: [row, { ...row, profile_found: false }],
    calculatedAt: now,
  }), /availability_shadow_idempotency_conflict/);
});

test("tenant, account, target and username isolation fail closed", () => {
  for (const patch of [
    { tenant_id: "other" },
    { account_id: "other" },
    { target_id: "other" },
    { searched_username: "other" },
  ]) {
    assert.throws(() => runTargetAvailabilityLocalShadow({
      scope,
      observations: [observation(12, patch)],
      calculatedAt: now,
    }), /availability_shadow_(scope|username_scope)_mismatch/);
  }
});
