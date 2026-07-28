import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicCandidateSearchProvider, EmptyCandidateSearchProvider, FailingCandidateSearchProvider, FixtureCandidateSearchProvider } from "./candidate-search-provider.ts";
import { CT_PREMIUM_CANDIDATE_FIXTURES } from "./fixtures.ts";
import { CtDomainError } from "./errors.ts";
import type { CtLowStockGateInput } from "./low-stock-gate.ts";
import { runCtShadowGeneration, type CtShadowPipelineInput } from "./shadow-pipeline.ts";
import { assertActivatableBatch } from "./shadow-safety.ts";
import type { CtCanonicalSnapshotInput } from "./snapshot.ts";
import { buildCtTargetingCriteriaSnapshot } from "./snapshot.ts";
import { ACCOUNT_A, ACCOUNT_B, FixedClock, SequenceIds, TENANT_A } from "./test-helpers.ts";

const clock = new FixedClock("2026-07-28T12:00:00.000Z");
const gateInput = (overrides: Partial<CtLowStockGateInput> = {}): CtLowStockGateInput => ({ tenantId: TENANT_A, accountId: ACCOUNT_A, plan: "premium", premiumEntitlementActive: true, ownershipActive: true, paused: false, canceled: false, campaignBlocked: false, lifecycleCompatible: true, eligibleTargetCount: 5, onboarding: { status: "ready", initialValidTargetCount: 15 }, existingActiveBatch: null, clock, ...overrides });
const snapshotInput = (overrides: Partial<CtCanonicalSnapshotInput> = {}): CtCanonicalSnapshotInput => ({ tenantId: TENANT_A, accountId: ACCOUNT_A, plan: "premium", entitlementIdentity: "entitlement_fixture", entitlementVersion: "v1", eligibleTargetCount: 5, accountLanguage: "fr", targetGeographies: ["za"], targetLanguages: ["fr"], categories: ["fitness"], followerRange: { min: 100, max: 100_000 }, engagementExpectation: 0.4, accountAnalysis: { fixture: true }, activeTargetUsernames: [], historicalTargetPerformance: [], sourceTargetPerformance: {}, followbackSignals: {}, skipEligibilitySignals: {}, blacklistUsernames: [], scoringVersion: "ct-premium-scoring-v1", searchStrategyVersion: "ct-premium-search-v1", batchSize: 10, triggerReason: "low_stock_threshold", createdAt: "2026-07-28T12:00:00.000Z", ...overrides });
const pipelineInput = (overrides: Partial<CtShadowPipelineInput> = {}): CtShadowPipelineInput => ({ gateInput: gateInput(), snapshotInput: snapshotInput(), provider: new FixtureCandidateSearchProvider(CT_PREMIUM_CANDIDATE_FIXTURES, clock), clock, ids: new SequenceIds(), activeProposalUsernames: [], ...overrides });

test("shadow pipeline generates an observable batch without mutation or activation", async () => {
  const result = await runCtShadowGeneration(pipelineInput());
  assert.equal(result.status, "generated");
  assert.equal(result.mode, "shadow");
  assert.equal(result.mutationExecuted, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.shadowBatch?.proposals.length, 10);
  assert.equal(result.quality.candidateCount, 10);
  assert.equal(result.quality.retainedCount, 10);
  assert.equal(result.recommendation, "ready_for_future_live_shadow");
  assert.equal(result.providerHealth, "healthy");
  assert.equal(result.candidateEvaluations.length, 10);
  assert.equal(result.lowestRetainedScore, 74.62);
  assert.equal(result.highestRejectedScore, null);
  assert.throws(() => assertActivatableBatch(result.shadowBatch!), (error) => error instanceof CtDomainError && error.code === "activation_blocked");
});

test("shadow pipeline skips non-triggering stock and blocks cross-account scope", async () => {
  const stock = await runCtShadowGeneration(pipelineInput({ gateInput: gateInput({ eligibleTargetCount: 6 }) }));
  assert.equal(stock.status, "skipped");
  assert.equal(stock.providerResult, null);
  const cross = await runCtShadowGeneration(pipelineInput({ snapshotInput: snapshotInput({ accountId: ACCOUNT_B }) }));
  assert.equal(cross.status, "blocked");
  assert.deepEqual(cross.errors, ["cross_account_access"]);
});

test("identical prior snapshot is idempotently skipped", async () => {
  const previous = buildCtTargetingCriteriaSnapshot(snapshotInput({ createdAt: "2026-07-27T12:00:00.000Z" }), new SequenceIds());
  const result = await runCtShadowGeneration(pipelineInput({ previousSnapshots: [previous] }));
  assert.equal(result.status, "skipped");
  assert.equal(result.snapshotCompatibility, "identical");
  assert.equal(result.providerResult, null);
});

test("material snapshot drift blocks stale shadow generation", async () => {
  const previous = buildCtTargetingCriteriaSnapshot(snapshotInput({ targetLanguages: ["en"] }), new SequenceIds());
  const result = await runCtShadowGeneration(pipelineInput({ previousSnapshots: [previous] }));
  assert.equal(result.status, "blocked");
  assert.equal(result.snapshotCompatibility, "materially_changed");
});

test("provider failure and empty results are explicit safe reports", async () => {
  const failed = await runCtShadowGeneration(pipelineInput({ provider: new FailingCandidateSearchProvider("fixture_failure") }));
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.errors, ["fixture_failure"]);
  const empty = await runCtShadowGeneration(pipelineInput({ provider: new EmptyCandidateSearchProvider(clock) }));
  assert.equal(empty.status, "skipped");
  assert.equal(empty.recommendation, "insufficient_candidates");
  assert.equal(empty.providerHealth, "empty");
});

test("post-search runtime drift aborts before batch construction", async () => {
  const result = await runCtShadowGeneration(pipelineInput({ readCurrentGateInput: async () => gateInput({ paused: true }) }));
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.errors, ["account_state_changed"]);
  assert.equal(result.shadowBatch, null);
});

test("duplicates and blacklist exclusions remain account-scoped and observable", async () => {
  const candidates = [CT_PREMIUM_CANDIDATE_FIXTURES[0], { ...CT_PREMIUM_CANDIDATE_FIXTURES[1], username: "blocked_fixture" }];
  const result = await runCtShadowGeneration(pipelineInput({ provider: new FixtureCandidateSearchProvider(candidates, clock), snapshotInput: snapshotInput({ activeTargetUsernames: [candidates[0].username], blacklistUsernames: ["blocked_fixture"] }) }));
  assert.equal(result.status, "skipped");
  assert.equal(result.exclusionCounts.duplicate_active_target, 1);
  assert.equal(result.exclusionCounts.blacklisted, 1);
  assert.equal(result.mutationExecuted, false);
});

test("shadow batch supports fewer than 10, defaults to 10 and caps configuration at 20", async () => {
  const fewer = await runCtShadowGeneration(pipelineInput({ provider: new FixtureCandidateSearchProvider(CT_PREMIUM_CANDIDATE_FIXTURES.slice(0, 3), clock) }));
  assert.equal(fewer.proposedCount, 3);
  const ten = await runCtShadowGeneration(pipelineInput({ provider: new DeterministicCandidateSearchProvider(clock) }));
  assert.equal(ten.proposedCount, 10);
  const twenty = await runCtShadowGeneration(pipelineInput({ provider: new DeterministicCandidateSearchProvider(clock), snapshotInput: snapshotInput({ batchSize: 20 }) }));
  assert.equal(twenty.proposedCount, 20);
});

test("existing batch key is idempotent and report metrics are complete and serializable", async () => {
  const first = await runCtShadowGeneration(pipelineInput());
  const retry = await runCtShadowGeneration(pipelineInput({ existingShadowIdempotencyKeys: [first.idempotencyKey] }));
  assert.equal(retry.status, "blocked");
  assert.deepEqual(retry.errors, ["idempotency_conflict"]);
  assert.equal(first.snapshotFingerprint, first.snapshot?.fingerprint);
  assert.equal(first.providerTrace?.version, "v1");
  assert.equal(first.scoreDistribution.average, first.qualitySummary.averageScore);
  assert.equal(first.proposedCount, first.scoredCandidates.length);
  assert.equal(first.exclusions.total, 0);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(first)));
});
