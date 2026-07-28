import { CT_SCORING_V1 } from "./scoring.ts";
import type { AccountId, BatchId, CtAccountRuntimeState, CtCommercialState, CtProposal, CtProposalBatch, CtProposalCandidate, ProposalId, SnapshotId, TenantId } from "./types.ts";

const tenant = (value: string) => value as TenantId;
const account = (value: string) => value as AccountId;
const proposal = (value: string) => value as ProposalId;

export const CT_PREMIUM_SYNTHETIC_SCOPES = Object.freeze({
  premiumSingle: { tenantId: tenant("tenant_fixture_premium_single"), accounts: [{ accountId: account("account_fixture_premium_single"), plan: "premium" as const }] },
  premiumAgency: { tenantId: tenant("tenant_fixture_agency_premium"), accounts: [1, 2, 3].map((index) => ({ accountId: account(`account_fixture_agency_premium_${index}`), plan: "premium" as const })) },
  mixedAgency: { tenantId: tenant("tenant_fixture_agency_mixed"), accounts: (["growth", "pro", "premium"] as const).map((plan) => ({ accountId: account(`account_fixture_mixed_${plan}`), plan })) },
});

export const CT_PREMIUM_CANDIDATE_FIXTURES: readonly CtProposalCandidate[] = Object.freeze(Array.from({ length: 10 }, (_, index) => ({
  username: `synthetic_candidate_${index + 1}`,
  displayName: `Synthetic Candidate ${index + 1}`,
  biography: "Synthetic fixture profile only",
  followersCount: 800 + index * 350,
  audienceMatch: Math.max(.45, .95 - index * .04),
  languageMatch: .9,
  geographyMatch: .8,
  categoryMatch: .85,
  followerRangeMatch: .9,
  engagementQuality: Math.max(.4, .9 - index * .04),
  profileActivity: .8,
  sourceTargetPerformance: .7,
  historicalFollowbackSignal: .65,
  profileEligibilityConfidence: .9,
  isEligible: true,
})));

export const CT_PREMIUM_EDGE_FIXTURES = Object.freeze({
  stockFive: { eligibleTargetCount: 5 },
  stockSix: { eligibleTargetCount: 6 },
  blacklist: ["synthetic_blacklisted"],
  activeDuplicate: ["synthetic_active_duplicate"],
  concurrencyConflict: { expectedVersion: 2, actualVersion: 3 },
  partialActivationFailure: { failedProposalIds: [proposal("proposal_fixture_failure")] },
});

export function syntheticRuntime(overrides: Partial<CtAccountRuntimeState> = {}): CtAccountRuntimeState {
  return { exists: true, ownershipActive: true, paused: false, canceled: false, campaignBlocked: false, lifecycleCompatible: true, eligibleTargetCount: 5, ...overrides };
}
export function syntheticCommercial(overrides: Partial<CtCommercialState> = {}): CtCommercialState {
  return { plan: "premium", premiumEntitlementActive: true, entitlementId: "entitlement_fixture_premium", entitlementExpiresAt: null, ...overrides };
}
export function syntheticReviewBatch(status: CtProposalBatch["status"] = "ready_for_review"): CtProposalBatch {
  const scope = CT_PREMIUM_SYNTHETIC_SCOPES.premiumSingle;
  return { id: "batch_fixture_review" as BatchId, tenantId: scope.tenantId, accountId: scope.accounts[0].accountId, snapshotId: "snapshot_fixture_review" as SnapshotId, entitlementId: "entitlement_fixture_premium", status, proposalIds: CT_PREMIUM_CANDIDATE_FIXTURES.map((_, index) => proposal(`proposal_fixture_${index + 1}`)), reviewWindow: { startedAt: "2026-07-01T00:00:00.000Z", expiresAt: "2026-07-06T00:00:00.000Z", durationDays: 5 }, idempotencyKey: "fixture_review_key", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", version: 1, frozenReason: status === "frozen" ? "premium_required" : null };
}
export function syntheticReviewProposals(statuses: readonly CtProposal["status"][] = CT_PREMIUM_CANDIDATE_FIXTURES.map(() => "pending")): readonly CtProposal[] {
  const batch = syntheticReviewBatch();
  return CT_PREMIUM_CANDIDATE_FIXTURES.map((candidate, index) => ({ id: batch.proposalIds[index], tenantId: batch.tenantId, accountId: batch.accountId, batchId: batch.id, normalizedUsername: candidate.username, displayName: candidate.displayName ?? null, followersCount: candidate.followersCount ?? null, score: { version: CT_SCORING_V1.version, total: 92 - index * 4, band: index < 5 ? "recommended" : "review", breakdown: {}, positiveReasons: ["audienceMatch", "categoryMatch"], penalties: [], exclusionFlags: [] }, status: statuses[index] ?? "pending", decision: null, createdAt: batch.createdAt, updatedAt: batch.updatedAt, version: 1 }));
}
