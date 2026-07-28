import type { CtBatchBuildResult, CtProposalBatch, CtProposalScore, CtTargetingCriteriaSnapshot } from "./types.ts";
import type { CtCandidateSearchResult } from "./candidate-search-provider.ts";
import type { CtLowStockGateDecision } from "./low-stock-gate.ts";

export interface CtShadowBatch {
  readonly mode: "shadow";
  readonly id: CtProposalBatch["id"];
  readonly tenantId: CtProposalBatch["tenantId"];
  readonly accountId: CtProposalBatch["accountId"];
  readonly snapshotId: CtProposalBatch["snapshotId"];
  readonly entitlementId: CtProposalBatch["entitlementId"];
  readonly status: "shadow_ready_for_review";
  readonly proposalIds: CtProposalBatch["proposalIds"];
  readonly idempotencyKey: string;
  readonly generatedAt: string;
  readonly proposals: CtBatchBuildResult["proposals"];
  readonly excluded: CtBatchBuildResult["excluded"];
}

export interface CtShadowQualitySummary {
  candidateCount: number;
  retainedCount: number;
  averageScore: number | null;
  medianScore: number | null;
  bands: Readonly<Record<CtProposalScore["band"], number>>;
}

export interface CtShadowExclusionSummary {
  total: number;
  invalid: number;
  duplicates: number;
  blacklisted: number;
  ineligible: number;
  byReason: Readonly<Record<string, number>>;
}

export interface CtShadowScoreDistribution {
  average: number | null;
  median: number | null;
  bands: Readonly<Record<CtProposalScore["band"], number>>;
}

export interface CtShadowRecommendation { code: string; requiresHumanReview: boolean }

export interface CtShadowReport {
  readonly runId: string;
  readonly mode: "shadow";
  readonly tenantId: CtLowStockGateDecision["tenantId"];
  readonly accountId: CtLowStockGateDecision["accountId"];
  readonly status: "generated" | "skipped" | "blocked" | "failed";
  readonly mutationExecuted: false;
  readonly activationAllowed: false;
  readonly gate: CtLowStockGateDecision;
  readonly gateResult: CtLowStockGateDecision;
  readonly snapshot: CtTargetingCriteriaSnapshot | null;
  readonly snapshotFingerprint: string | null;
  readonly snapshotCompatibility: "new" | "identical" | "compatible" | "materially_changed" | "invalid";
  readonly providerResult: CtCandidateSearchResult | null;
  readonly providerTrace: Readonly<{ provider: string; version: string; traceId: string; durationMs: number }> | null;
  readonly candidatesReceived: number;
  readonly scoredCandidates: readonly Readonly<{ username: string; score: CtProposalScore }>[];
  readonly shadowBatch: CtShadowBatch | null;
  readonly quality: CtShadowQualitySummary;
  readonly qualitySummary: CtShadowQualitySummary;
  readonly scoreDistribution: CtShadowScoreDistribution;
  readonly exclusionCounts: Readonly<Record<string, number>>;
  readonly exclusions: CtShadowExclusionSummary;
  readonly proposedCount: number;
  readonly idempotencyKey: string;
  readonly recommendation: string;
  readonly recommendationDetail: CtShadowRecommendation;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly generatedAt: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly stepDurationsMs: Readonly<Record<string, number>>;
}

export type CtShadowRunReport = CtShadowReport;
