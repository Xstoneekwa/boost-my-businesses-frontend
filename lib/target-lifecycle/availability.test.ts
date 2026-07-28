import assert from "node:assert/strict";
import test from "node:test";
import {
  assessTargetAvailability,
  assessTargetLifecycle,
  computeTargetAccountStock,
  decideTargetPlanPolicy,
} from "./index.ts";
import type {
  TargetAvailabilityAssessment,
  TargetAvailabilityEvidence,
  TargetAvailabilityStatus,
  TargetPlan,
} from "./types.ts";

const now = "2026-07-28T12:00:00.000Z";
const scope = {
  tenantId: "tenant_one",
  accountId: "account_one",
  targetId: "target_one",
  normalizedUsername: "target_one",
  stablePlatformUserId: "ig_100",
};
const evidence = (
  evidenceId: string,
  patch: Partial<TargetAvailabilityEvidence> = {},
): TargetAvailabilityEvidence => ({
  evidenceId,
  observedAt: `2026-07-28T10:${evidenceId.padStart(2, "0")}:00.000Z`,
  source: "synthetic",
  runId: `run_${evidenceId}`,
  deviceId: "device_one",
  searchedUsername: "target_one",
  observedUsername: "target_one",
  observedStablePlatformUserId: "ig_100",
  lookupResult: "found",
  profileFound: true,
  verifiedBadge: false,
  followersSurface: "normal",
  networkHealthy: true,
  sessionHealthy: true,
  uiEvidenceQuality: "high",
  workerVersion: "synthetic-v1",
  ...patch,
});
const assess = (
  rows: readonly TargetAvailabilityEvidence[],
  patch: Partial<typeof scope> & { calculatedAt?: string } = {},
) => assessTargetAvailability({
  ...scope,
  ...patch,
  evidence: rows,
  calculatedAt: patch.calculatedAt ?? now,
});

const restricted = (id: string, verifiedBadge = true) => evidence(id, {
  verifiedBadge,
  followersSurface: "restricted",
  accessibleProfilesCount: 50,
  repeatedProfilesDetected: true,
});
const notFound = (id: string, networkHealthy = true) => evidence(id, {
  lookupResult: "not_found",
  profileFound: false,
  observedUsername: null,
  observedStablePlatformUserId: null,
  followersSurface: "unknown",
  networkHealthy,
});

test("22-scenario universal availability matrix remains deterministic and fail-closed", () => {
  const scenarios: Array<[string, TargetAvailabilityAssessment, TargetAvailabilityStatus]> = [
    ["01 available", assess([evidence("01")]), "available"],
    ["02 stable-id rename", assess([evidence("02", { observedUsername: "target_one_new" })]), "username_changed"],
    ["03 old username reassigned", assess([evidence("03", { observedStablePlatformUserId: "ig_other" })]), "identity_conflict"],
    ["04 one not-found", assess([notFound("04")]), "temporarily_unavailable"],
    ["05 three healthy not-found", assess([notFound("05"), notFound("06"), notFound("07")]), "deleted_or_not_found"],
    ["06 repeated network error", assess([
      evidence("08", { lookupResult: "failed", profileFound: null, networkHealthy: false, followersSurface: "unknown" }),
      evidence("09", { lookupResult: "failed", profileFound: null, networkHealthy: false, followersSurface: "unknown" }),
    ]), "lookup_failed"],
    ["07 strongly confirmed deleted", assess([notFound("10"), notFound("11"), notFound("12")]), "deleted_or_not_found"],
    ["08 ambiguous suspended", assess([
      evidence("13", { lookupResult: "unavailable", profileFound: null, followersSurface: "unknown" }),
    ]), "temporarily_unavailable"],
    ["09 verified at add with normal followers", assess([evidence("14", { verifiedBadge: true })]), "available"],
    ["10 became verified but no restriction", assess([evidence("15"), evidence("16", { verifiedBadge: true })]), "available"],
    ["11 verified badge normal followers", assess([evidence("17", { verifiedBadge: true })]), "available"],
    ["12 verified and terminally limited", assess([evidence("18", {
      verifiedBadge: true,
      followersSurface: "terminally_limited",
      accessibleProfilesCount: 50,
      terminalEndDetected: true,
    })]), "verified_restricted"],
    ["13 one surface limitation", assess([restricted("19")]), "followers_surface_restricted"],
    ["14 two restricted controls", assess([restricted("20"), restricted("21")]), "verified_restricted"],
    ["15 terminal end without badge", assess([evidence("22", {
      followersSurface: "terminally_limited",
      terminalEndDetected: true,
    })]), "followers_surface_restricted"],
    ["16 repeated first profiles", assess([restricted("23", false), restricted("24", false)]), "followers_surface_restricted"],
    ["17 conflicting identity", assess([evidence("25", { observedUsername: "other", observedStablePlatformUserId: "ig_other" })]), "identity_conflict"],
    ["18 Growth unavailable", assess([notFound("26"), notFound("27"), notFound("28")]), "deleted_or_not_found"],
    ["19 Pro verified restricted", assess([restricted("29"), restricted("30")]), "verified_restricted"],
    ["20 Premium restricted without replacement", assess([restricted("31"), restricted("32")]), "verified_restricted"],
    ["21 Premium replacement ready", assess([restricted("33"), restricted("34")]), "verified_restricted"],
    ["22 agency account isolated", assess([evidence("35")], { accountId: "agency_account_two", targetId: "agency_target" }), "available"],
  ];

  assert.equal(scenarios.length, 22);
  for (const [label, assessment, expected] of scenarios) {
    assert.equal(assessment.status, expected, label);
    assert.deepEqual(JSON.parse(JSON.stringify(assessment)), assessment, `${label}: serializable`);
    assert.deepEqual(assessTargetAvailability({
      ...assessment.scope,
      evidence: label === "01 available" ? [evidence("01")] : [],
      calculatedAt: now,
    }).calculatedAt, now);
  }
});

test("username update requires a stable identity match and preserves target scope", () => {
  const renamed = assess([evidence("01", { observedUsername: "target_one_official" })]);
  assert.equal(renamed.identityResolution.automaticUsernameUpdateAllowed, true);
  assert.equal(renamed.identityResolution.stablePlatformUserId, "ig_100");
  assert.equal(renamed.scope.targetId, "target_one");
  assert.deepEqual(renamed.reasons, ["target_username_changed", "target_identity_match_confirmed"]);

  const noStoredIdentity = assessTargetAvailability({
    ...scope,
    stablePlatformUserId: null,
    evidence: [evidence("02", { observedUsername: "target_one_official" })],
    calculatedAt: now,
  });
  assert.notEqual(noStoredIdentity.status, "username_changed");
  assert.equal(noStoredIdentity.identityResolution.automaticUsernameUpdateAllowed, false);
});

test("verified badge alone remains available while repeated or terminal restriction requires replacement", () => {
  assert.equal(assess([evidence("01", { verifiedBadge: true })]).replacementRequired, false);
  assert.equal(assess([restricted("02")]).status, "followers_surface_restricted");
  const repeated = assess([restricted("03"), restricted("04")]);
  assert.equal(repeated.status, "verified_restricted");
  assert.equal(repeated.replacementRequired, true);
  assert.ok(repeated.reasons.includes("target_verified_followers_surface_restricted"));
});

test("stale and weak evidence never becomes terminal", () => {
  const stale = assess([evidence("01", { observedAt: "2026-06-01T00:00:00.000Z" })]);
  assert.equal(stale.status, "stale_evidence");
  assert.equal(stale.recheckRequired, true);
  assert.equal(stale.replacementRequired, false);
  assert.equal(assess([]).confidence, "unknown");
});

function lifecycleWithAvailability(availability: TargetAvailabilityAssessment) {
  return assessTargetLifecycle({
    tenantId: availability.scope.tenantId,
    accountId: availability.scope.accountId,
    targetId: availability.scope.targetId,
    normalizedUsername: availability.scope.normalizedUsername,
    uniqueProfilesEvaluated: 100,
    estimatedExploitableAudience: 1_000,
    denominatorObservedAt: now,
    historicalCoverage: 1,
    calculatedAt: now,
    availability,
  });
}

function decide(plan: TargetPlan, availability: TargetAvailabilityAssessment, replacementState: "none" | "ready_for_review" | "activated" = "none") {
  const assessment = lifecycleWithAvailability(availability);
  return decideTargetPlanPolicy({
    plan,
    assessment,
    availabilityAssessment: availability,
    eligibleTargetCount: 5,
    minimumEligibleTargetCount: 6,
    onboardingComplete: true,
    replacementState,
    evaluatedAt: now,
  });
}

test("the same terminal assessment asks Growth/Pro clients and prepares Premium replacement", () => {
  const unavailable = assess([notFound("01"), notFound("02"), notFound("03")]);
  assert.equal(decide("growth", unavailable).action, "request_client_targets");
  assert.equal(decide("pro", unavailable).action, "request_client_targets");
  assert.equal(decide("premium", unavailable).action, "prepare_automatic_replacement");
  assert.equal(decide("premium", unavailable, "ready_for_review").action, "mark_replacement_pending");
  assert.equal(decide("premium", unavailable, "activated").archiveAllowed, true);
});

test("temporary failures quarantine, rename resolves identity and conflicts require an operator", () => {
  assert.equal(decide("premium", assess([notFound("01")])).action, "quarantine_target");
  assert.equal(decide("growth", assess([evidence("02", { observedUsername: "new_name" })])).action, "resolve_target_identity");
  assert.equal(decide("premium", assess([evidence("03", { observedStablePlatformUserId: "ig_other" })])).action, "hold_for_operator");
});

test("gate <=5 excludes terminal availability and identity conflicts but keeps temporary recheck provisionally", () => {
  const available = lifecycleWithAvailability(assess([evidence("01")]));
  const terminal = lifecycleWithAvailability(assess([notFound("02"), notFound("03"), notFound("04")], { targetId: "terminal" }));
  const conflict = lifecycleWithAvailability(assess([evidence("05", { observedStablePlatformUserId: "other" })], { targetId: "conflict" }));
  const temporary = lifecycleWithAvailability(assess([notFound("06")], { targetId: "temporary" }));
  const stock = computeTargetAccountStock([available, terminal, conflict, temporary], {
    tenantId: "tenant_one",
    accountId: "account_one",
    minimumEligibleTargetCount: 5,
  });
  assert.deepEqual(stock.includedTargetIds, ["target_one", "temporary"]);
  assert.equal(stock.lowStock, true);
});

test("pure availability evaluation has no mutation or side effect", () => {
  const rows = Object.freeze([Object.freeze(evidence("01"))]);
  const before = JSON.stringify(rows);
  const first = assess(rows);
  const second = assess(rows);
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
});
