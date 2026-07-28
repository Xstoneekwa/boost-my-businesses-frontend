import assert from "node:assert/strict";
import test from "node:test";
import { CT_PREMIUM_PRODUCT_CONFIG } from "../config.ts";
import { evaluateCtLowStockGate } from "../low-stock-gate.ts";
import { CT_SCORING_V1, scoreProposalCandidate } from "../scoring.ts";
import { buildCtTargetingCriteriaSnapshot, compareSnapshotCompatibility, type CtCanonicalSnapshotInput } from "../snapshot.ts";
import type { AccountId, CtIdGenerator, TenantId } from "../types.ts";
import { runCtShadowValidationSuite } from "./harness.ts";
import { percentile } from "./metrics.ts";
import { evaluateShadowQuality } from "./quality.ts";
import { buildCtShadowValidationScenarios } from "./scenarios.ts";

class Ids implements CtIdGenerator { private value = 0; next(kind: "batch" | "proposal" | "snapshot" | "target") { this.value += 1; return `${kind}_validation_test_${this.value}`; } }
const tenantId = "tenant_synthetic_validation_test" as TenantId;
const accountId = "account_synthetic_validation_test" as AccountId;
const now = { now: () => new Date("2026-07-28T12:00:00.000Z") };

test("scenario matrix deterministically contains at least 100 cases and every required dimension", () => {
  const scenarios = buildCtShadowValidationScenarios();
  assert.equal(scenarios.length, 168);
  assert.deepEqual(buildCtShadowValidationScenarios(), scenarios);
  for (const plan of ["growth", "pro", "premium"]) assert.ok(scenarios.some((scenario) => scenario.plan === plan));
  for (const stock of [0, 1, 5, 6, 14, 15, 20]) assert.ok(scenarios.some((scenario) => scenario.stock === stock));
  for (const structure of ["single", "premium_agency", "mixed_agency", "same_tenant_distinct_criteria"]) assert.ok(scenarios.some((scenario) => scenario.tenantStructure === structure));
  for (const mode of ["provider_failure", "interrupted", "idempotency_conflict", "duplicates", "blacklisted", "active", "mixed"]) assert.ok(scenarios.some((scenario) => scenario.candidateMode === mode));
});

test("full synthetic validation suite has zero invariant failures and serializes", async () => {
  const suite = await runCtShadowValidationSuite();
  assert.equal(suite.aggregate.scenarioCount, 168);
  assert.equal(suite.aggregate.failCount, 0, JSON.stringify(suite.findings.slice(0, 5)));
  assert.equal(suite.verdict, "pass");
  assert.equal(suite.aggregate.idempotenceStabilityRate, 1);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(suite)));
  const quality = evaluateShadowQuality(suite);
  assert.equal(quality.verdict, "pass");
  assert.ok(quality.recommendations.includes("ready_for_future_live_shadow"));
});

test("gate 15/5 matrix remains unambiguous", () => {
  const base = { tenantId, accountId, plan: "premium" as const, premiumEntitlementActive: true, ownershipActive: true, paused: false, canceled: false, campaignBlocked: false, lifecycleCompatible: true, eligibleTargetCount: 5, onboarding: { status: "ready" as const, initialValidTargetCount: 15 }, existingActiveBatch: null, clock: now };
  assert.equal(evaluateCtLowStockGate(base).action, "prepare_premium_batch");
  assert.equal(evaluateCtLowStockGate({ ...base, eligibleTargetCount: 6 }).action, "no_action");
  assert.equal(evaluateCtLowStockGate({ ...base, onboarding: { status: "ready", initialValidTargetCount: 14 } }).action, "onboarding_incomplete");
  assert.equal(evaluateCtLowStockGate({ ...base, plan: "growth", premiumEntitlementActive: false }).action, "request_client_targets");
  assert.equal(evaluateCtLowStockGate({ ...base, plan: "pro", premiumEntitlementActive: false }).action, "request_client_targets");
  for (const override of [{ paused: true }, { canceled: true }, { campaignBlocked: true }, { ownershipActive: false }, { lifecycleCompatible: false }]) assert.equal(evaluateCtLowStockGate({ ...base, ...override }).action, "blocked");
});

function snapshot(overrides: Partial<CtCanonicalSnapshotInput> = {}): CtCanonicalSnapshotInput {
  return { tenantId, accountId, plan: "premium", entitlementIdentity: "entitlement_synthetic", entitlementVersion: "v1", eligibleTargetCount: 5, accountLanguage: "fr", targetGeographies: ["za"], targetLanguages: ["fr"], categories: ["fitness"], followerRange: { min: 100, max: 10_000 }, engagementExpectation: .4, accountAnalysis: { synthetic: true }, activeTargetUsernames: [], historicalTargetPerformance: [], sourceTargetPerformance: {}, followbackSignals: {}, skipEligibilitySignals: {}, blacklistUsernames: [], rejectedCooldownDays: 30, scoringVersion: CT_SCORING_V1.version, searchStrategyVersion: "ct-premium-search-v1", batchSize: 10, triggerReason: "validation", createdAt: "2026-07-28T12:00:00.000Z", ...overrides };
}

test("snapshot change classification covers all material fields and compatible history", () => {
  const base = buildCtTargetingCriteriaSnapshot(snapshot(), new Ids());
  assert.equal(compareSnapshotCompatibility(base, buildCtTargetingCriteriaSnapshot(snapshot({ createdAt: "2026-07-29T12:00:00.000Z" }), new Ids())), "identical");
  assert.equal(compareSnapshotCompatibility(base, buildCtTargetingCriteriaSnapshot(snapshot({ sourceTargetPerformance: { source: .8 } }), new Ids())), "compatible");
  const material: Array<Partial<CtCanonicalSnapshotInput>> = [{ accountLanguage: "en" }, { targetGeographies: ["fr"] }, { categories: ["wellness"] }, { followerRange: { min: 500, max: 5_000 } }, { blacklistUsernames: ["blocked"] }, { activeTargetUsernames: ["active"] }, { scoringVersion: "v2" }, { searchStrategyVersion: "v2" }, { batchSize: 20 }, { rejectedCooldownDays: 45 }];
  for (const change of material) assert.equal(compareSnapshotCompatibility(base, buildCtTargetingCriteriaSnapshot(snapshot(change), new Ids())), "materially_changed");
  assert.equal(compareSnapshotCompatibility(base, buildCtTargetingCriteriaSnapshot(snapshot({ accountId: "account_synthetic_other" as AccountId }), new Ids())), "invalid");
});

test("scoring V1 is monotonic per signal, bounded and not dominated by a minor signal", () => {
  assert.equal(Object.values(CT_SCORING_V1.weights).reduce((sum, weight) => sum + weight, 0), 100);
  const signals = Object.keys(CT_SCORING_V1.weights) as Array<keyof typeof CT_SCORING_V1.weights>;
  const baseline = Object.fromEntries(signals.map((signal) => [signal, .5]));
  for (const signal of signals) {
    const low = scoreProposalCandidate({ username: "synthetic_low", biography: "synthetic", followersCount: 1000, ...baseline, [signal]: 0 });
    const high = scoreProposalCandidate({ username: "synthetic_high", biography: "synthetic", followersCount: 1000, ...baseline, [signal]: 1 });
    assert.ok(high.total >= low.total);
    assert.ok(high.total - low.total <= CT_SCORING_V1.weights[signal]);
  }
  assert.equal(scoreProposalCandidate({ username: "synthetic_bad", biography: "synthetic", followersCount: 1000, audienceMatch: 0, languageMatch: 1, geographyMatch: 0, categoryMatch: 0, followerRangeMatch: 0, engagementQuality: 0, profileActivity: 0, sourceTargetPerformance: 0, historicalFollowbackSignal: 0, profileEligibilityConfidence: 0 }).band, "reject");
  assert.equal(scoreProposalCandidate({ username: "synthetic_good", biography: "synthetic", followersCount: 1000, ...Object.fromEntries(signals.map((signal) => [signal, .9])) }).band, "recommended");
});

test("percentiles use deterministic linear interpolation", () => {
  assert.equal(percentile([], .5), null);
  assert.equal(percentile([0, 10, 20, 30, 40], .25), 10);
  assert.equal(percentile([0, 10, 20, 30], .5), 15);
  assert.equal(CT_PREMIUM_PRODUCT_CONFIG.defaultBatchSize, 10);
  assert.equal(CT_PREMIUM_PRODUCT_CONFIG.maxBatchSize, 20);
});
