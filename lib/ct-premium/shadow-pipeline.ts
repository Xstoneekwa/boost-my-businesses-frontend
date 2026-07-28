import { buildProposalBatch } from "./batch-builder.ts";
import type { CtCandidateSearchProvider } from "./candidate-search-provider.ts";
import { defaultCtBatchBuildConfig } from "./config.ts";
import { evaluateCtLowStockGate, type CtLowStockGateInput } from "./low-stock-gate.ts";
import { buildCtTargetingCriteriaSnapshot, compareSnapshotCompatibility, ctStableFingerprint, type CtCanonicalSnapshotInput } from "./snapshot.ts";
import type { CtShadowQualitySummary, CtShadowReport } from "./shadow-types.ts";
import type { CtClock, CtIdGenerator, CtProposalScore, CtTargetingCriteriaSnapshot } from "./types.ts";

export interface CtShadowPipelineInput {
  gateInput: CtLowStockGateInput;
  snapshotInput: CtCanonicalSnapshotInput;
  provider: CtCandidateSearchProvider;
  clock: CtClock;
  ids: CtIdGenerator;
  activeProposalUsernames: readonly string[];
  previousSnapshots?: readonly CtTargetingCriteriaSnapshot[];
  existingShadowIdempotencyKeys?: readonly string[];
  readCurrentGateInput?: () => Promise<CtLowStockGateInput>;
}

const emptyQuality = (): CtShadowQualitySummary => ({ candidateCount: 0, retainedCount: 0, averageScore: null, medianScore: null, bands: { reject: 0, review: 0, recommended: 0 } });

function quality(scores: readonly CtProposalScore[], candidateCount: number): CtShadowQualitySummary {
  const totals = scores.map((score) => score.total).sort((a, b) => a - b);
  const midpoint = Math.floor(totals.length / 2);
  const median = totals.length ? (totals.length % 2 ? totals[midpoint] : (totals[midpoint - 1] + totals[midpoint]) / 2) : null;
  return {
    candidateCount, retainedCount: scores.length,
    averageScore: totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : null,
    medianScore: median,
    bands: scores.reduce((bands, score) => ({ ...bands, [score.band]: bands[score.band] + 1 }), { reject: 0, review: 0, recommended: 0 }),
  };
}

export async function runCtShadowGeneration(input: CtShadowPipelineInput): Promise<CtShadowReport> {
  const generatedAt = input.clock.now().toISOString();
  const initialGate = evaluateCtLowStockGate(input.gateInput);
  const baseKey = ctStableFingerprint({ tenantId: input.gateInput.tenantId, accountId: input.gateInput.accountId, evaluatedAt: initialGate.evaluatedAt });
  const report = (values: Partial<CtShadowReport>): CtShadowReport => {
    const qualityValue = values.quality ?? emptyQuality();
    const exclusionCounts = values.exclusionCounts ?? {};
    const recommendation = values.recommendation ?? "review_shadow_failure";
    const snapshot = values.snapshot ?? null;
    const providerResult = values.providerResult ?? null;
    return Object.freeze({ runId: `shadow_run_${baseKey}`, mode: "shadow", tenantId: input.gateInput.tenantId, accountId: input.gateInput.accountId, status: "failed", mutationExecuted: false, activationAllowed: false, gate: initialGate, gateResult: values.gate ?? initialGate, snapshot, snapshotFingerprint: snapshot?.fingerprint ?? null, snapshotCompatibility: "new", providerResult, providerTrace: providerResult ? { provider: providerResult.provider, version: providerResult.providerVersion, traceId: providerResult.traceId, durationMs: providerResult.durationMs } : null, candidatesReceived: providerResult?.candidates.length ?? 0, scoredCandidates: values.shadowBatch?.proposals.map((proposal) => ({ username: proposal.normalizedUsername, score: proposal.score })) ?? [], shadowBatch: null, quality: qualityValue, qualitySummary: qualityValue, scoreDistribution: { average: qualityValue.averageScore, median: qualityValue.medianScore, bands: qualityValue.bands }, exclusionCounts, exclusions: { total: Object.values(exclusionCounts).reduce((sum, count) => sum + count, 0), invalid: exclusionCounts.invalid_username ?? 0, duplicates: (exclusionCounts.duplicate_in_batch ?? 0) + (exclusionCounts.duplicate_active_target ?? 0) + (exclusionCounts.duplicate_active_proposal ?? 0), blacklisted: exclusionCounts.blacklisted ?? 0, ineligible: (exclusionCounts.profile_not_eligible ?? 0) + (exclusionCounts.score_below_threshold ?? 0), byReason: exclusionCounts }, proposedCount: values.shadowBatch?.proposals.length ?? 0, idempotencyKey: baseKey, recommendation, recommendationDetail: { code: recommendation, requiresHumanReview: true }, warnings: providerResult?.warnings ?? [], errors: [], generatedAt, startedAt: generatedAt, completedAt: generatedAt, stepDurationsMs: { gate: 0, snapshot: 0, provider: providerResult?.durationMs ?? 0, scoring: 0 }, ...values });
  };

  if (input.snapshotInput.tenantId !== input.gateInput.tenantId || input.snapshotInput.accountId !== input.gateInput.accountId) return report({ status: "blocked", snapshotCompatibility: "invalid", recommendation: "fix_scope_before_retry", errors: ["cross_account_access"] });
  if (initialGate.action !== "prepare_premium_batch") return report({ status: initialGate.action === "no_action" || initialGate.action === "batch_already_active" ? "skipped" : "blocked", recommendation: initialGate.reason, errors: initialGate.action === "blocked" ? [initialGate.reason] : [] });

  const snapshot = buildCtTargetingCriteriaSnapshot(input.snapshotInput, input.ids);
  const previous = input.previousSnapshots?.at(-1);
  const snapshotCompatibility = previous ? compareSnapshotCompatibility(previous, snapshot) : "new";
  if (snapshotCompatibility === "identical") return report({ status: "skipped", snapshot, snapshotCompatibility, idempotencyKey: ctStableFingerprint({ scope: snapshot.accountId, snapshot: snapshot.fingerprint }), recommendation: "identical_shadow_already_evaluated" });
  if (snapshotCompatibility === "materially_changed" || snapshotCompatibility === "invalid") return report({ status: "blocked", snapshot, snapshotCompatibility, recommendation: "refresh_snapshot_review", errors: [`snapshot_${snapshotCompatibility}`] });

  let providerResult;
  try {
    providerResult = await input.provider.searchCandidates({ tenantId: snapshot.tenantId, accountId: snapshot.accountId, snapshot, maxCandidates: snapshot.batchSize * 3 });
  } catch (error) {
    return report({ snapshot, snapshotCompatibility, recommendation: "retry_provider_after_review", errors: [error instanceof Error ? error.message : "candidate_provider_failed"] });
  }

  if (input.readCurrentGateInput) {
    const currentGate = evaluateCtLowStockGate(await input.readCurrentGateInput());
    if (currentGate.action !== "prepare_premium_batch") return report({ status: "blocked", gate: currentGate, snapshot, snapshotCompatibility, providerResult, recommendation: "account_state_changed", errors: ["account_state_changed"] });
  }

  const built = buildProposalBatch({
    snapshot, candidates: providerResult.candidates, activeTargetUsernames: snapshot.activeTargetUsernames,
    activeProposalUsernames: input.activeProposalUsernames, blacklistUsernames: snapshot.blacklistUsernames,
    commercial: { plan: input.gateInput.plan, premiumEntitlementActive: input.gateInput.premiumEntitlementActive, entitlementId: snapshot.entitlementIdentity, entitlementExpiresAt: null },
    runtime: { exists: true, ownershipActive: input.gateInput.ownershipActive, paused: input.gateInput.paused, canceled: input.gateInput.canceled, campaignBlocked: input.gateInput.campaignBlocked, lifecycleCompatible: input.gateInput.lifecycleCompatible, eligibleTargetCount: input.gateInput.eligibleTargetCount },
    existingIdempotencyKeys: input.existingShadowIdempotencyKeys, clock: input.clock, ids: input.ids,
    config: defaultCtBatchBuildConfig(snapshot.batchSize),
  });
  const exclusionCounts = built.excluded.flatMap((entry) => entry.reasons).reduce<Record<string, number>>((counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }), {});
  const idempotencyKey = built.batch?.idempotencyKey ?? ctStableFingerprint({ snapshot: snapshot.fingerprint, candidates: providerResult.candidates.map((candidate) => candidate.username) });
  if (!built.batch) return report({ status: built.error ? "blocked" : "skipped", snapshot, snapshotCompatibility, providerResult, exclusionCounts, idempotencyKey, recommendation: built.explanation, errors: built.error ? [built.error] : [] });
  const shadowBatch = Object.freeze({ mode: "shadow" as const, id: built.batch.id, tenantId: built.batch.tenantId, accountId: built.batch.accountId, snapshotId: built.batch.snapshotId, entitlementId: built.batch.entitlementId, status: "shadow_ready_for_review" as const, proposalIds: built.batch.proposalIds, idempotencyKey: built.batch.idempotencyKey, generatedAt, proposals: built.proposals, excluded: built.excluded });
  return report({ status: "generated", snapshot, snapshotCompatibility, providerResult, shadowBatch, quality: quality(built.proposals.map((proposal) => proposal.score), providerResult.candidates.length), exclusionCounts, idempotencyKey, recommendation: "review_shadow_quality_before_persistence" });
}

export const runCtPremiumShadowGeneration = runCtShadowGeneration;
