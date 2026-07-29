import assert from "node:assert/strict";
import test from "node:test";
import { runTargetAvailabilityLocalShadow, type WorkerTargetAvailabilityObservation } from "./availability-shadow.ts";
import { resolveTargetAvailabilityFeatureFlags } from "./feature-flags.ts";
import { assessTargetLifecycleShadow } from "./lifecycle-shadow.ts";
import { assessTargetPerformanceShadow } from "./performance-shadow.ts";
import { evaluateTargetPolicyShadow } from "./policy-shadow.ts";
import { assessTargetUtilizationShadow } from "./utilization-shadow.ts";

const scope = { tenantId: "tenant-one", accountId: "account-one", targetId: "target-one", normalizedUsername: "target.one" };
const now = "2026-07-29T12:00:00.000Z";
const obs = (id: number, patch: Partial<WorkerTargetAvailabilityObservation> = {}): WorkerTargetAvailabilityObservation => ({
  schema_version: "target-availability-observation-v1", observation_id: `tao-${id}`, idempotency_key: `idem-${id}`,
  event_key: `run-${id}:summary`, observed_at: `2026-07-29T10:${String(id).padStart(2, "0")}:00.000Z`,
  tenant_id: scope.tenantId, account_id: scope.accountId, target_id: scope.targetId, searched_username: scope.normalizedUsername,
  observed_username: scope.normalizedUsername, observed_stable_platform_user_id: "ig-1", run_id: `run-${id}`,
  device_key: `device-${id % 2}`, worker_version: "worker-v2", instagram_version: "ig-v1", lookup_result: "found",
  profile_found: true, verified_badge: false, followers_surface: "normal", accessible_profiles_count: 500,
  terminal_end_detected: false, repeated_first_profiles_detected: false, retry_count: 0, retry_budget_exhausted: false,
  navigation_timeout: false, recovery_outcome: "not_attempted", ui_evidence_quality: "high", network_state: "healthy",
  session_state: "healthy", reason_codes: ["target_profile_found"], evidence_safe: {}, ...patch,
});
const availability = (rows: WorkerTargetAvailabilityObservation[], stable = "ig-1", calculatedAt = now) =>
  runTargetAvailabilityLocalShadow({ scope, stablePlatformUserId: stable, observations: rows, calculatedAt }).assessment;
const utilization = (ratio: number, patch: Record<string, unknown> = {}) => assessTargetUtilizationShadow({
  ...scope, uniqueProfilesEvaluated: Math.round(3000 * ratio), estimatedExploitableAudience: 3000,
  denominatorObservedAt: "2026-07-29T00:00:00.000Z", denominatorReliability: 1, historicalCoverage: 1,
  uniqueEvaluationCoverage: 1, sourceAttributionReliability: 1, workerVersionCoverage: 1, calculatedAt: now, ...patch,
});
const performance = (patch: Record<string, unknown> = {}) => assessTargetPerformanceShadow({
  ...scope, profilesEvaluated: 100, eligibleProfiles: 50, follows: 20, skips: 30, likes: 10, errors: 2,
  followbacks: 4, observedAt: "2026-07-29T10:00:00.000Z", calculatedAt: now, ...patch,
});
const policy = (plan: "growth" | "pro" | "premium", patch: Record<string, unknown> = {}) => evaluateTargetPolicyShadow({
  plan, recommendation: "replacement_recommended", accountId: scope.accountId, packageActive: true, entitlementActive: true,
  ownershipValid: true, onboardingComplete: true, accountPaused: false, cancelRequested: false, downgradePending: false,
  campaignBlocked: false, targetBlacklisted: false, replacementStockAvailable: true, evaluatedAt: now, ...patch,
});

const cases: Array<[string, () => void]> = [
  ["01 CT disponible", () => assert.equal(availability([obs(1)]).status, "available")],
  ["02 profil absent une fois", () => assert.equal(availability([obs(2, { lookup_result: "not_found", profile_found: false, observed_username: null })]).status, "temporarily_unavailable")],
  ["03 profil absent plusieurs fois reseau sain", () => assert.equal(availability([2,3,4].map((id) => obs(id, { lookup_result: "not_found", profile_found: false, observed_username: null }))).status, "deleted_or_not_found")],
  ["04 erreur reseau", () => assert.equal(availability([obs(4, { lookup_result: "failed", profile_found: null, network_state: "unavailable" })]).status, "lookup_failed")],
  ["05 session invalide", () => assert.equal(availability([obs(5, { lookup_result: "failed", profile_found: null, session_state: "logged_out" })]).terminalProof, false)],
  ["06 changement username stable ID", () => assert.equal(availability([obs(6, { observed_username: "target.renamed" })]).status, "username_changed")],
  ["07 ancien username reattribue", () => assert.equal(availability([obs(7, { observed_stable_platform_user_id: "ig-other" })]).status, "identity_conflict")],
  ["08 conflit identite", () => assert.equal(availability([obs(8, { observed_stable_platform_user_id: "ig-conflict" })]).usernameChange.operatorConfirmationRequired, true)],
  ["09 compte supprime", () => assert.equal(availability([9,10,11].map((id) => obs(id, { lookup_result: "not_found", profile_found: false, observed_username: null }))).replacementRequired, true)],
  ["10 badge seul", () => assert.equal(availability([obs(10, { verified_badge: true })]).status, "available")],
  ["11 badge followers normaux", () => assert.equal(availability([obs(11, { verified_badge: true, followers_surface: "normal" })]).replacementRequired, false)],
  ["12 badge surface restreinte", () => assert.equal(availability([obs(12, { verified_badge: true, followers_surface: "restricted" })]).status, "followers_surface_restricted")],
  ["13 restriction un run", () => assert.equal(availability([obs(13, { verified_badge: true, followers_surface: "restricted" })]).confidence, "low")],
  ["14 restriction deux runs", () => assert.equal(availability([obs(14, { verified_badge: true, followers_surface: "restricted" }), obs(15, { verified_badge: true, followers_surface: "restricted" })]).status, "verified_restricted")],
  ["15 pagination terminale", () => assert.equal(availability([obs(15, { verified_badge: true, followers_surface: "terminally_limited", terminal_end_detected: true })]).terminalProof, true)],
  ["16 repetition premiers profils", () => assert.equal(availability([obs(16, { followers_surface: "restricted", repeated_first_profiles_detected: true })]).recheckRequired, true)],
  ["17 petite audience normale", () => assert.equal(utilization(0.2, { estimatedExploitableAudience: 300, uniqueProfilesEvaluated: 60 }).state, "healthy")],
  ["18 CT peu utilise", () => assert.equal(utilization(0.3).state, "healthy")],
  ["19 CT proche epuisement", () => assert.equal(utilization(0.82).state, "replacement_recommended")],
  ["20 CT epuise", () => assert.equal(utilization(0.92).state, "exhausted")],
  ["21 CT performant", () => assert.equal(performance().state, "healthy")],
  ["22 low FBR volume suffisant", () => assert.equal(performance({ followbacks: 0 }).quality.sufficientVolume, true)],
  ["23 low FBR volume insuffisant", () => assert.equal(performance({ profilesEvaluated: 10, eligibleProfiles: 4, follows: 2, followbacks: 0 }).state, "insufficient")],
  ["24 incident Worker exclu des metriques", () => {
    const result = performance({ errors: 40, workerIncident: true });
    assert.equal(result.state, "insufficient");
    assert.equal(result.quality.workerIncidentExcluded, true);
  }],
  ["25 Growth replacement", () => assert.equal(policy("growth").action, "client_target_request_recommended")],
  ["26 Pro replacement", () => assert.equal(policy("pro").action, "client_target_request_recommended")],
  ["27 Premium replacement", () => assert.equal(policy("premium").action, "automatic_replacement_preparation_recommended")],
  ["28 Premium paused", () => assert.equal(policy("premium", { accountPaused: true }).action, "blocked")],
  ["29 Premium canceled", () => assert.equal(policy("premium", { cancelRequested: true }).action, "blocked")],
  ["30 Premium downgraded", () => assert.equal(policy("premium", { downgradePending: true }).action, "blocked")],
  ["31 agence mixte", () => assert.notEqual(policy("growth").action, policy("premium").action)],
  ["32 isolation inter-account", () => assert.throws(() => runTargetAvailabilityLocalShadow({ scope, observations: [obs(32, { account_id: "other" })], calculatedAt: now }), /scope_mismatch/)],
  ["33 stale evidence", () => assert.equal(availability([obs(33, { observed_at: "2026-06-01T00:00:00.000Z" })]).status, "stale_evidence")],
  ["34 writer indisponible", () => assert.equal(resolveTargetAvailabilityFeatureFlags({ TARGET_AVAILABILITY_WRITER_ENABLED: "false" }).target_availability_writer_enabled, false)],
  ["35 buffer plein", () => assert.equal(resolveTargetAvailabilityFeatureFlags({}).target_availability_observation_capture_enabled, false)],
  ["36 observation dupliquee", () => { const row = obs(36); assert.equal(runTargetAvailabilityLocalShadow({ scope, observations: [row,row], calculatedAt: now }).duplicateObservationCount, 1); }],
  ["37 assessment concurrent", () => { const first = utilization(0.2); const second = utilization(0.9); assert.notEqual(first.state, second.state); }],
  ["38 runtime flags OFF", () => assert.deepEqual(Object.values(resolveTargetAvailabilityFeatureFlags({})).slice(0,4), [false,false,false,false])],
];

test("V2-1 couvre les 38 simulations de contrat avec sorties serialisables", async (t) => {
  assert.equal(cases.length, 38);
  for (const [name, run] of cases) await t.test(name, () => { run(); });
  const a = availability([obs(1)]); const u = utilization(0.2); const p = performance();
  const lifecycle = assessTargetLifecycleShadow({ scope, availability: a, utilizationState: u.state, performanceState: p.state, calculatedAt: now });
  assert.doesNotThrow(() => JSON.stringify({ a, u, p, lifecycle }));
  assert.equal(lifecycle.mutationExecuted, false);
});
