import assert from "node:assert/strict";
import test from "node:test";
import { CT_PREMIUM_PRODUCT_CONFIG } from "./config.ts";
import { evaluateCtLowStockGate, type CtLowStockGateInput } from "./low-stock-gate.ts";
import { buildCtTargetingCriteriaSnapshot, compareSnapshotCompatibility, type CtCanonicalSnapshotInput } from "./snapshot.ts";
import { ACCOUNT_A, ACCOUNT_B, FixedClock, SequenceIds, TENANT_A } from "./test-helpers.ts";

const clock = new FixedClock("2026-07-28T10:00:00.000Z");
const gateInput = (overrides: Partial<CtLowStockGateInput> = {}): CtLowStockGateInput => ({
  tenantId: TENANT_A, accountId: ACCOUNT_A, plan: "premium", premiumEntitlementActive: true,
  ownershipActive: true, paused: false, canceled: false, campaignBlocked: false,
  lifecycleCompatible: true, eligibleTargetCount: 5,
  onboarding: { status: "ready", initialValidTargetCount: 15 }, existingActiveBatch: null, clock, ...overrides,
});

test("low-stock gate triggers Premium at exactly 5 and stays idle at 6", () => {
  const premium = evaluateCtLowStockGate(gateInput());
  assert.equal(premium.action, "prepare_premium_batch");
  assert.equal(premium.reasonCode, "low_stock_premium");
  assert.equal(premium.triggered, true);
  assert.equal(premium.snapshotRequired, true);
  assert.equal(premium.shadowGenerationAllowed, true);
  assert.equal(evaluateCtLowStockGate(gateInput({ eligibleTargetCount: 6 })).action, "no_action");
});

test("Growth and Pro request client targets while inactive Premium is blocked", () => {
  for (const plan of ["growth", "pro"] as const) {
    const decision = evaluateCtLowStockGate(gateInput({ plan, premiumEntitlementActive: false }));
    assert.equal(decision.action, "request_client_targets");
    assert.equal(decision.reason, plan === "growth" ? "low_stock_growth" : "low_stock_pro");
  }
  assert.equal(evaluateCtLowStockGate(gateInput({ premiumEntitlementActive: false })).reason, "premium_entitlement_inactive");
});

test("gate fails closed for onboarding, runtime blockers and batch scope", () => {
  assert.equal(evaluateCtLowStockGate(gateInput({ onboarding: { status: "incomplete", initialValidTargetCount: 0 } })).reason, "onboarding_incomplete");
  assert.equal(evaluateCtLowStockGate(gateInput({ onboarding: { status: "ready", initialValidTargetCount: 14 } })).reason, "onboarding_minimum_not_met");
  const blockers: Array<[Partial<CtLowStockGateInput>, string]> = [
    [{ ownershipActive: false }, "ownership_inactive"], [{ paused: true }, "account_paused"],
    [{ canceled: true }, "account_canceled"], [{ campaignBlocked: true }, "campaign_blocked"],
    [{ lifecycleCompatible: false }, "lifecycle_incompatible"],
  ];
  for (const [override, reason] of blockers) assert.equal(evaluateCtLowStockGate(gateInput(override)).reason, reason);
  assert.equal(evaluateCtLowStockGate(gateInput({ existingActiveBatch: { tenantId: TENANT_A, accountId: ACCOUNT_A, batchId: "batch_1" } })).action, "batch_already_active");
  assert.equal(evaluateCtLowStockGate(gateInput({ existingActiveBatch: { tenantId: TENANT_A, accountId: ACCOUNT_B, batchId: "batch_other" } })).reason, "cross_account_access");
});

const snapshotInput = (overrides: Partial<CtCanonicalSnapshotInput> = {}): CtCanonicalSnapshotInput => ({
  tenantId: TENANT_A, accountId: ACCOUNT_A, plan: "premium", entitlementIdentity: "entitlement_a", entitlementVersion: "v2",
  eligibleTargetCount: 5, accountLanguage: "FR", targetGeographies: ["ZA", "fr"], targetLanguages: ["EN", "fr"],
  categories: ["Sport", "fitness"], followerRange: { min: 500, max: 50_000 }, engagementExpectation: 0.5,
  accountAnalysis: { niche: "fitness", verified: true }, activeTargetUsernames: ["@Zulu", "alpha"],
  historicalTargetPerformance: [{ username: "@Zulu", follows: 20, followbacks: 3 }],
  sourceTargetPerformance: { zulu: 0.7, alpha: 0.4 }, followbackSignals: { zulu: 0.15 },
  skipEligibilitySignals: { privateProfiles: true, minimumPosts: 3 }, blacklistUsernames: ["@Blocked"],
  scoringVersion: CT_PREMIUM_PRODUCT_CONFIG.scoringVersion, searchStrategyVersion: CT_PREMIUM_PRODUCT_CONFIG.searchStrategyVersion,
  batchSize: 10, triggerReason: "low_stock_threshold", createdAt: "2026-07-28T10:00:00.000Z", ...overrides,
});

test("canonical snapshots are deterministic, normalized, serializable and deeply frozen", () => {
  const first = buildCtTargetingCriteriaSnapshot(snapshotInput(), new SequenceIds());
  const reordered = buildCtTargetingCriteriaSnapshot(snapshotInput({ targetGeographies: ["fr", "ZA"], categories: ["fitness", "Sport"], createdAt: "2026-07-29T10:00:00.000Z" }), new SequenceIds());
  assert.equal(first.fingerprint, reordered.fingerprint);
  assert.deepEqual(first.targetGeographies, ["fr", "za"]);
  assert.deepEqual(first.activeTargetUsernames, ["alpha", "zulu"]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.accountAnalysis), true);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(first)));
});

test("snapshot compatibility distinguishes operational drift, material changes and scope", () => {
  const first = buildCtTargetingCriteriaSnapshot(snapshotInput(), new SequenceIds());
  const identical = buildCtTargetingCriteriaSnapshot(snapshotInput({ createdAt: "2026-07-30T10:00:00.000Z" }), new SequenceIds());
  const compatible = buildCtTargetingCriteriaSnapshot(snapshotInput({ eligibleTargetCount: 4, sourceTargetPerformance: { zulu: 0.8 } }), new SequenceIds());
  const material = buildCtTargetingCriteriaSnapshot(snapshotInput({ targetLanguages: ["de"] }), new SequenceIds());
  const otherAccount = buildCtTargetingCriteriaSnapshot(snapshotInput({ accountId: ACCOUNT_B }), new SequenceIds());
  assert.equal(compareSnapshotCompatibility(first, identical), "identical");
  assert.equal(compareSnapshotCompatibility(first, compatible), "compatible");
  assert.equal(compareSnapshotCompatibility(first, material), "materially_changed");
  assert.equal(compareSnapshotCompatibility(first, otherAccount), "invalid");
});

test("snapshot validation enforces configured batch maximum and versioned identity", () => {
  assert.throws(() => buildCtTargetingCriteriaSnapshot(snapshotInput({ batchSize: 21 }), new SequenceIds()), /invalid_snapshot_batch_size/);
  assert.throws(() => buildCtTargetingCriteriaSnapshot(snapshotInput({ entitlementIdentity: "" }), new SequenceIds()), /invalid_snapshot_scope/);
  assert.equal(CT_PREMIUM_PRODUCT_CONFIG.onboardingMinimumValidTargets, 15);
  assert.equal(CT_PREMIUM_PRODUCT_CONFIG.lowStockThreshold, 5);
});
