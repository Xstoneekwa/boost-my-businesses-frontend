import assert from "node:assert/strict";
import test from "node:test";
import {
  assessTargetLifecycleGlobalShadow,
  TARGET_LIFECYCLE_ENGINE_REVISION,
  TARGET_LIFECYCLE_ENGINE_VERSION,
  type TargetLifecycleGlobalShadowInput,
} from "./global-shadow-engine.ts";

const now = "2026-07-31T12:00:00.000Z";
const base: TargetLifecycleGlobalShadowInput = {
  scope: {
    tenantId: "11111111-1111-4111-8111-111111111111",
    accountId: "22222222-2222-4222-8222-222222222222",
    targetId: "33333333-3333-4333-8333-333333333333",
    normalizedUsername: "@Target.One",
  },
  archived: false,
  replacementPending: false,
  availability: {
    assessmentId: "44444444-4444-4444-8444-444444444444",
    status: "available",
    identityStatus: "identity_confirmed",
    confidence: "high",
    latestObservationAt: "2026-07-31T11:00:00.000Z",
    validUntil: "2026-08-01T11:00:00.000Z",
    terminalProof: false,
    reasonCodes: ["target_available"],
  },
  performance: {
    sourceObservationId: null,
    follows: 120,
    followbacks: 18,
    skips: 42,
    errors: 1,
    fbrPercent: 15,
    reliability: "strong",
    observedAt: "2026-07-31T10:00:00.000Z",
  },
  utilization: {
    state: "healthy",
    uniqueProfilesEvaluated: 300,
    estimatedExploitableAudience: 1_000,
    utilizationRatio: 0.3,
    observedAt: "2026-07-31T09:00:00.000Z",
    terminalProof: false,
    reasonCodes: ["target_healthy"],
  },
  calculatedAt: now,
};

const assess = (patch: Partial<TargetLifecycleGlobalShadowInput> = {}) =>
  assessTargetLifecycleGlobalShadow({ ...base, ...patch });

const cases: ReadonlyArray<readonly [string, Partial<TargetLifecycleGlobalShadowInput>, string, string]> = [
  ["01 healthy", {}, "healthy", "monitor"],
  ["02 archived source truth", { archived: true }, "archived", "monitor"],
  ["03 identity conflict", { availability: { ...base.availability!, status: "identity_conflict" } }, "insufficient_data", "operator_identity_review"],
  ["04 identity ambiguous", { availability: { ...base.availability!, identityStatus: "identity_ambiguous" } }, "insufficient_data", "operator_identity_review"],
  ["05 stable id missing", { availability: { ...base.availability!, identityStatus: "stable_id_missing" } }, "insufficient_data", "operator_identity_review"],
  ["06 deleted confirmed high", { availability: { ...base.availability!, status: "deleted_or_not_found" } }, "replacement_recommended", "replacement_review"],
  ["07 permanent unavailable medium", { availability: { ...base.availability!, status: "permanently_unavailable", confidence: "medium" } }, "replacement_recommended", "replacement_review"],
  ["08 unavailable low confidence watches", { availability: { ...base.availability!, status: "permanently_unavailable", confidence: "low" }, performance: null }, "insufficient_data", "collect_more_evidence"],
  ["09 terminal unavailable overrides low", { availability: { ...base.availability!, status: "permanently_unavailable", confidence: "low", terminalProof: true } }, "replacement_recommended", "replacement_review"],
  ["10 suspended", { availability: { ...base.availability!, status: "suspended_or_disabled" } }, "replacement_recommended", "replacement_review"],
  ["11 verified restricted", { availability: { ...base.availability!, status: "verified_restricted" } }, "replacement_recommended", "replacement_review"],
  ["12 replacement pending wins", { replacementPending: true }, "replacement_pending", "replacement_review"],
  ["13 utilization exhausted", { utilization: { ...base.utilization, state: "exhausted", terminalProof: true } }, "exhausted", "replacement_review"],
  ["14 utilization pending", { utilization: { ...base.utilization, state: "replacement_pending" } }, "replacement_pending", "replacement_review"],
  ["15 utilization recommended", { utilization: { ...base.utilization, state: "replacement_recommended" } }, "replacement_recommended", "replacement_review"],
  ["16 low FBR at exactly 100", { performance: { ...base.performance!, follows: 100, followbacks: 7, fbrPercent: 7 } }, "replacement_recommended", "replacement_review"],
  ["17 low FBR below 100 is insufficient", { performance: { ...base.performance!, follows: 99, followbacks: 0, fbrPercent: 0 } }, "insufficient_data", "collect_more_evidence"],
  ["18 FBR exactly eight is not low", { performance: { ...base.performance!, follows: 100, followbacks: 8, fbrPercent: 8 } }, "healthy", "monitor"],
  ["19 unreliable FBR is insufficient", { performance: { ...base.performance!, reliability: "unknown", follows: 500, followbacks: 0, fbrPercent: 0 } }, "insufficient_data", "collect_more_evidence"],
  ["20 invalid counters fail closed", { performance: { ...base.performance!, follows: 10, followbacks: 11, fbrPercent: 110 } }, "insufficient_data", "collect_more_evidence"],
  ["21 stale availability", { availability: { ...base.availability!, latestObservationAt: "2026-07-01T00:00:00.000Z", validUntil: "2026-07-15T00:00:00.000Z" } }, "stale_data", "recheck_stale_evidence"],
  ["22 stale performance", { performance: { ...base.performance!, observedAt: "2026-07-01T00:00:00.000Z" } }, "stale_data", "recheck_stale_evidence"],
  ["23 stale utilization", { utilization: { ...base.utilization, state: "stale_data" } }, "stale_data", "recheck_stale_evidence"],
  ["24 availability missing", { availability: null }, "insufficient_data", "collect_more_evidence"],
  ["25 performance missing", { performance: null }, "insufficient_data", "collect_more_evidence"],
  ["26 utilization missing", { utilization: { ...base.utilization, state: "insufficient_data" } }, "insufficient_data", "collect_more_evidence"],
  ["27 temporary unavailable watches with complete evidence", { availability: { ...base.availability!, status: "temporarily_unavailable" } }, "watch", "monitor"],
  ["28 utilization watch", { utilization: { ...base.utilization, state: "watch" } }, "watch", "monitor"],
  ["29 username changed with confirmed identity stays healthy", { availability: { ...base.availability!, status: "username_changed" } }, "healthy", "monitor"],
  ["30 lookup failure is insufficient", { availability: { ...base.availability!, status: "lookup_failed" } }, "insufficient_data", "collect_more_evidence"],
  ["31 unavailable outranks exhausted", { availability: { ...base.availability!, status: "deleted_or_not_found" }, utilization: { ...base.utilization, state: "exhausted" } }, "replacement_recommended", "replacement_review"],
  ["32 identity ambiguity outranks unavailable and exhaustion", { availability: { ...base.availability!, status: "deleted_or_not_found", identityStatus: "identity_conflict" }, utilization: { ...base.utilization, state: "exhausted" } }, "insufficient_data", "operator_identity_review"],
  ["33 V3 unavailable confirmed is authoritative", { availability: { ...base.availability!, status: "unavailable_confirmed", confidence: "low", terminalProof: false } }, "replacement_recommended", "replacement_review"],
  ["34 V3 verified restriction confirmed is authoritative", { availability: { ...base.availability!, status: "verified_restricted_confirmed", confidence: "low", terminalProof: false } }, "replacement_recommended", "replacement_review"],
  ["35 V3 verified restriction suspected watches", { availability: { ...base.availability!, status: "verified_restricted_suspected" } }, "watch", "monitor"],
  ["36 V3 unavailable suspected watches", { availability: { ...base.availability!, status: "unavailable_suspected" } }, "watch", "monitor"],
  ["37 V3 likely available watches", { availability: { ...base.availability!, status: "likely_available" } }, "watch", "monitor"],
  ["38 V3 identity changed with confirmed identity stays healthy", { availability: { ...base.availability!, status: "identity_changed" } }, "healthy", "monitor"],
  ["39 V3 stale status is stale", { availability: { ...base.availability!, status: "stale" } }, "stale_data", "recheck_stale_evidence"],
  ["40 V3 conflicting evidence fails closed", { availability: { ...base.availability!, status: "conflicting_evidence" } }, "insufficient_data", "collect_more_evidence"],
  ["41 invalid Performance skips fail closed", { performance: { ...base.performance!, skips: -1 } }, "insufficient_data", "collect_more_evidence"],
];

test("global Lifecycle priority matrix covers at least 30 deterministic replay cases", async (t) => {
  assert.ok(cases.length >= 30);
  for (const [name, patch, expectedStatus, expectedAction] of cases) {
    await t.test(name, () => {
      const first = assess(patch);
      const replay = assess(patch);
      assert.equal(first.status, expectedStatus);
      assert.equal(first.recommendedAction, expectedAction);
      assert.deepEqual(replay, first);
      assert.doesNotThrow(() => JSON.stringify(first));
      assert.equal(first.businessActionAllowed, false);
      assert.equal(first.enforcementAllowed, false);
      assert.equal(first.mutationExecuted, false);
    });
  }
});

test("source freshness, identity and version metadata are explicit", () => {
  const result = assess();
  assert.equal(result.scope.normalizedUsername, "target.one");
  assert.equal(result.sourceMaxObservedAt, "2026-07-31T11:00:00.000Z");
  assert.equal(result.engineVersion, TARGET_LIFECYCLE_ENGINE_VERSION);
  assert.equal(result.engineRevision, TARGET_LIFECYCLE_ENGINE_REVISION);
  assert.equal(result.validUntil, "2026-08-14T09:00:00.000Z");
  assert.deepEqual(result.missingEvidence, []);
});

test("invalid calculatedAt fails closed", () => {
  assert.throws(() => assess({ calculatedAt: "invalid" }), /target_lifecycle_calculated_at_invalid/);
});

test("an accidental enforcement environment has no engine input or effect", () => {
  process.env.TARGET_LIFECYCLE_ENFORCE_ENABLED = "true";
  process.env.TARGET_LIFECYCLE_BUSINESS_ACTIONS_ENABLED = "true";
  try {
    const result = assess();
    assert.equal(result.enforcementAllowed, false);
    assert.equal(result.businessActionAllowed, false);
    assert.equal(result.mutationExecuted, false);
  } finally {
    delete process.env.TARGET_LIFECYCLE_ENFORCE_ENABLED;
    delete process.env.TARGET_LIFECYCLE_BUSINESS_ACTIONS_ENABLED;
  }
});
