import assert from "node:assert/strict";
import test from "node:test";
import { buildProposalBatch } from "./batch-builder.ts";
import { CT_PREMIUM_PRODUCT_CONFIG, defaultCtBatchBuildConfig, resolveCtBatchSize } from "./config.ts";
import { CtDomainError } from "./errors.ts";
import { decideMany, decideProposal } from "./review.ts";
import { CT_SCORING_V1 } from "./scoring.ts";
import { buildCriteriaSnapshot } from "./snapshot.ts";
import { ACCOUNT_A, ACCOUNT_B, FixedClock, SequenceIds, TENANT_A, pendingProposal, premiumCommercial, readyRuntime, reviewBatch } from "./test-helpers.ts";

const strong = (username: string) => ({ username, biography: "Synthetic profile", followersCount: 2000, audienceMatch: 1, languageMatch: 1, geographyMatch: 1, categoryMatch: 1, followerRangeMatch: 1, engagementQuality: 1, profileActivity: 1, sourceTargetPerformance: 1, historicalFollowbackSignal: 1, profileEligibilityConfidence: 1 });

function build(stock = 5, candidates = [strong("candidate_one")], existingIdempotencyKeys: readonly string[] = []) {
  const ids = new SequenceIds();
  const snapshot = buildCriteriaSnapshot({ tenantId: TENANT_A, accountId: ACCOUNT_A, plan: "premium", accountLanguage: "fr", targetGeographies: ["ZA"], targetLanguages: ["fr"], categories: ["fitness"], followerRange: { min: 500, max: 50000 }, engagementExpectation: .5, accountAnalysis: { fixture: true }, activeTargetUsernames: [], historicalTargetPerformance: [], blacklistUsernames: [], scoringVersion: CT_SCORING_V1.version, createdAt: "2026-07-01T00:00:00.000Z" }, ids);
  return buildProposalBatch({ snapshot, candidates, activeTargetUsernames: [], activeProposalUsernames: [], blacklistUsernames: [], commercial: premiumCommercial(), runtime: readyRuntime({ eligibleTargetCount: stock }), existingIdempotencyKeys, clock: new FixedClock("2026-07-01T00:00:00.000Z"), ids, config: { maxProposals: 10, scoring: CT_SCORING_V1 } });
}

test("stock 5 builds an account-scoped batch with exact five-day review window", () => {
  const result = build();
  assert.equal(result.error, null);
  assert.equal(result.batch?.accountId, ACCOUNT_A);
  assert.equal(result.batch?.reviewWindow?.expiresAt, "2026-07-06T00:00:00.000Z");
  assert.equal(result.proposals.length, 1);
});

test("stock 6 and missing Premium block generation", () => {
  assert.equal(build(6).error, "stock_above_trigger");
  const ids = new SequenceIds();
  const snapshot = buildCriteriaSnapshot({ tenantId: TENANT_A, accountId: ACCOUNT_A, plan: "pro", accountLanguage: "en", targetGeographies: [], targetLanguages: [], categories: [], followerRange: { min: 0, max: 1 }, engagementExpectation: 0, accountAnalysis: {}, activeTargetUsernames: [], historicalTargetPerformance: [], blacklistUsernames: [], scoringVersion: CT_SCORING_V1.version, createdAt: "2026-07-01T00:00:00.000Z" }, ids);
  const result = buildProposalBatch({ snapshot, candidates: [strong("x")], activeTargetUsernames: [], activeProposalUsernames: [], blacklistUsernames: [], commercial: premiumCommercial({ plan: "pro", premiumEntitlementActive: false, entitlementId: null }), runtime: readyRuntime(), clock: new FixedClock("2026-07-01T00:00:00.000Z"), ids, config: { maxProposals: 10, scoring: CT_SCORING_V1 } });
  assert.equal(result.error, "premium_required");
});

test("builder handles no candidates, all excluded, max proposals and idempotency", () => {
  assert.equal(build(5, []).explanation, "no_candidates");
  assert.equal(build(5, [{ username: "bad-name!" }]).explanation, "all_candidates_excluded");
  const capped = build(5, Array.from({ length: 12 }, (_, index) => strong(`candidate_${index}`)));
  assert.equal(capped.proposals.length, 10);
  const first = build(5, [strong("candidate_one")]);
  assert.equal(build(5, [strong("candidate_one")], [first.batch!.idempotencyKey]).error, "idempotency_conflict");
});

test("manual accept/reject and bulk decisions are immutable and reject duplicates", () => {
  const original = pendingProposal();
  const accepted = decideProposal({ batch: reviewBatch(), proposal: original, requestedTenantId: TENANT_A, requestedAccountId: ACCOUNT_A, outcome: "accepted", source: "client", actorId: "client_fixture", commercial: premiumCommercial(), runtime: readyRuntime(), clock: new FixedClock("2026-07-02T00:00:00.000Z") });
  assert.equal(original.status, "pending");
  assert.equal(accepted.proposal.status, "accepted");
  assert.throws(() => decideProposal({ batch: reviewBatch(), proposal: accepted.proposal, requestedTenantId: TENANT_A, requestedAccountId: ACCOUNT_A, outcome: "rejected", source: "client", actorId: "client_fixture", commercial: premiumCommercial(), runtime: readyRuntime(), clock: new FixedClock("2026-07-02T00:00:00.000Z") }), (error) => error instanceof CtDomainError && error.code === "proposal_not_pending");
  const second = pendingProposal({ id: "proposal_fixture_2" as typeof original.id });
  const bulk = decideMany({ batch: reviewBatch({ proposalIds: [original.id, second.id] }), proposals: [original, second], proposalIds: [original.id, second.id], requestedTenantId: TENANT_A, requestedAccountId: ACCOUNT_A, outcome: "rejected", source: "client", actorId: "client_fixture", commercial: premiumCommercial(), runtime: readyRuntime(), clock: new FixedClock("2026-07-02T00:00:00.000Z") });
  assert.deepEqual(bulk.map((item) => item.proposal.status), ["rejected", "rejected"]);
});

test("cross-account, downgrade, pause, cancel and expiration block manual acceptance", () => {
  const base = { batch: reviewBatch(), proposal: pendingProposal(), requestedTenantId: TENANT_A, outcome: "accepted" as const, source: "client" as const, actorId: "client_fixture", commercial: premiumCommercial(), runtime: readyRuntime(), clock: new FixedClock("2026-07-02T00:00:00.000Z") };
  assert.throws(() => decideProposal({ ...base, requestedAccountId: ACCOUNT_B }), (error) => error instanceof CtDomainError && error.code === "cross_account_access");
  assert.throws(() => decideProposal({ ...base, requestedTenantId: "tenant_fixture_other" as typeof TENANT_A, requestedAccountId: ACCOUNT_A }), (error) => error instanceof CtDomainError && error.code === "cross_account_access");
  assert.throws(() => decideProposal({ ...base, requestedAccountId: ACCOUNT_A, commercial: premiumCommercial({ plan: "pro", premiumEntitlementActive: false }) }), (error) => error instanceof CtDomainError && error.code === "premium_required");
  assert.throws(() => decideProposal({ ...base, requestedAccountId: ACCOUNT_A, runtime: readyRuntime({ paused: true }) }), (error) => error instanceof CtDomainError && error.code === "account_paused");
  assert.throws(() => decideProposal({ ...base, requestedAccountId: ACCOUNT_A, runtime: readyRuntime({ canceled: true }) }), (error) => error instanceof CtDomainError && error.code === "account_canceled");
  assert.throws(() => decideProposal({ ...base, requestedAccountId: ACCOUNT_A, clock: new FixedClock("2026-07-06T00:00:00.000Z") }), (error) => error instanceof CtDomainError && error.code === "review_expired");
});

test("product defaults are centralized and batch size is capped at 20", () => {
  assert.deepEqual({
    onboarding: CT_PREMIUM_PRODUCT_CONFIG.onboardingMinimumValidTargets,
    lowStock: CT_PREMIUM_PRODUCT_CONFIG.lowStockThreshold,
    batch: CT_PREMIUM_PRODUCT_CONFIG.defaultBatchSize,
    max: CT_PREMIUM_PRODUCT_CONFIG.maxBatchSize,
    cooldown: CT_PREMIUM_PRODUCT_CONFIG.rejectionCooldownDays,
    review: CT_PREMIUM_PRODUCT_CONFIG.reviewDurationDays,
  }, { onboarding: 15, lowStock: 5, batch: 10, max: 20, cooldown: 30, review: 5 });
  assert.equal(defaultCtBatchBuildConfig().maxProposals, 10);
  assert.equal(resolveCtBatchSize(99), 20);
});
