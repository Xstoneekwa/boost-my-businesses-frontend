import { deduplicateCandidates } from "./normalization.ts";
import { evaluateGenerationEligibility } from "./eligibility.ts";
import { scoreProposalCandidate } from "./scoring.ts";
import { summarizeBatch } from "./review.ts";
import { ctStableFingerprint } from "./snapshot.ts";
import { CT_PREMIUM_PRODUCT_CONFIG, resolveCtBatchSize } from "./config.ts";
import type {
  BatchId, CtAccountRuntimeState, CtBatchBuildConfig, CtBatchBuildResult, CtClock, CtCommercialState,
  CtIdGenerator, CtProposal, CtProposalBatch, CtProposalCandidate, CtTargetingCriteriaSnapshot, ProposalId,
} from "./types.ts";

export function buildProposalBatch(input: {
  snapshot: CtTargetingCriteriaSnapshot;
  candidates: readonly CtProposalCandidate[];
  activeTargetUsernames: readonly string[];
  activeProposalUsernames: readonly string[];
  blacklistUsernames: readonly string[];
  commercial: CtCommercialState;
  runtime: CtAccountRuntimeState;
  existingIdempotencyKeys?: readonly string[];
  clock: CtClock;
  ids: CtIdGenerator;
  config: CtBatchBuildConfig;
}): CtBatchBuildResult {
  const eligibility = evaluateGenerationEligibility(input.commercial, input.runtime);
  const emptySummary = summarizeBatch([]);
  if (!eligibility.eligible) return { batch: null, proposals: [], excluded: [], events: [], summary: emptySummary, explanation: eligibility.reasons.join(","), error: eligibility.reasons[0] };
  const deduplicated = deduplicateCandidates(input.candidates, {
    activeTargetUsernames: input.activeTargetUsernames,
    activeProposalUsernames: input.activeProposalUsernames,
    blacklistUsernames: input.blacklistUsernames,
  });
  const scored = deduplicated.accepted.map((entry) => ({ ...entry, score: scoreProposalCandidate(entry.candidate, input.config.scoring) }));
  const scoreExcluded = scored.filter((entry) => entry.score.band === "reject").map((entry) => ({ username: entry.candidate.username, normalizedUsername: entry.normalizedUsername, reasons: ["score_below_threshold" as const] }));
  const retained = scored.filter((entry) => entry.score.band !== "reject").sort((left, right) => right.score.total - left.score.total || left.normalizedUsername.localeCompare(right.normalizedUsername)).slice(0, resolveCtBatchSize(input.config.maxProposals));
  const excluded = [...deduplicated.excluded, ...scoreExcluded];
  if (!retained.length) return { batch: null, proposals: [], excluded, events: [], summary: emptySummary, explanation: input.candidates.length ? "all_candidates_excluded" : "no_candidates", error: null };
  const now = input.clock.now();
  const createdAt = now.toISOString();
  const idempotencyKey = ctStableFingerprint({ accountId: input.snapshot.accountId, snapshotFingerprint: input.snapshot.fingerprint, candidates: retained.map((entry) => entry.normalizedUsername), scoringVersion: input.config.scoring.version });
  if (input.existingIdempotencyKeys?.includes(idempotencyKey)) return { batch: null, proposals: [], excluded, events: [], summary: emptySummary, explanation: "identical_batch_exists", error: "idempotency_conflict" };
  const batchId = input.ids.next("batch") as BatchId;
  const proposals: CtProposal[] = retained.map((entry) => Object.freeze({
    id: input.ids.next("proposal") as ProposalId,
    tenantId: input.snapshot.tenantId,
    accountId: input.snapshot.accountId,
    batchId,
    normalizedUsername: entry.normalizedUsername,
    displayName: entry.candidate.displayName ?? null,
    followersCount: entry.candidate.followersCount ?? null,
    score: entry.score,
    status: "pending" as const,
    decision: null,
    createdAt,
    updatedAt: createdAt,
    version: 1,
  }));
  const expiresAt = new Date(now.getTime() + CT_PREMIUM_PRODUCT_CONFIG.reviewDurationDays * 24 * 60 * 60 * 1000).toISOString();
  const batch: CtProposalBatch = Object.freeze({
    id: batchId,
    tenantId: input.snapshot.tenantId,
    accountId: input.snapshot.accountId,
    snapshotId: input.snapshot.id,
    entitlementId: input.commercial.entitlementId!,
    status: "ready_for_review",
    proposalIds: Object.freeze(proposals.map((proposal) => proposal.id)),
    reviewWindow: Object.freeze({ startedAt: createdAt, expiresAt, durationDays: CT_PREMIUM_PRODUCT_CONFIG.reviewDurationDays }),
    idempotencyKey,
    createdAt,
    updatedAt: createdAt,
    version: 1,
    frozenReason: null,
  });
  return {
    batch,
    proposals,
    excluded,
    events: [{ type: "batch.ready_for_review", tenantId: batch.tenantId, accountId: batch.accountId, batchId, actorId: "system", source: "system_revalidation", occurredAt: createdAt, metadata: { proposalCount: proposals.length } }],
    summary: summarizeBatch(proposals),
    explanation: `retained_${proposals.length}_of_${input.candidates.length}`,
    error: null,
  };
}
