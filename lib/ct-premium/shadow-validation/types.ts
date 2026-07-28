import type { CtShadowReport } from "../shadow-types.ts";
import type { CtPlan, CtTargetingCriteriaSnapshot } from "../types.ts";

export type CtShadowValidationVerdict = "pass" | "warning" | "fail";
export type CtValidationLifecycle = "ready" | "onboarding_incomplete" | "paused" | "canceled" | "blocked" | "active_batch" | "ownership_inactive" | "lifecycle_incompatible" | "entitlement_absent" | "entitlement_expired" | "entitlement_replaced";
export type CtValidationCandidateMode = "empty" | "three" | "ten" | "twenty_five" | "invalid" | "duplicates" | "blacklisted" | "active" | "low" | "medium" | "high" | "mixed" | "provider_failure" | "interrupted" | "idempotency_conflict";
export type CtValidationCriteriaMode = "broad" | "narrow" | "partial" | "complete" | "strong_history" | "weak_history" | "strong_followback" | "high_skip";
export type CtValidationTemporalMode = "before_expiry" | "at_expiry" | "after_expiry" | "cooldown_active" | "cooldown_expired" | "snapshot_identical" | "snapshot_compatible" | "snapshot_materially_changed";
export type CtValidationTenantStructure = "single" | "premium_agency" | "mixed_agency" | "same_tenant_distinct_criteria";

export interface CtShadowValidationScenario {
  id: string;
  plan: CtPlan;
  stock: 0 | 1 | 5 | 6 | 14 | 15 | 20;
  lifecycle: CtValidationLifecycle;
  candidateMode: CtValidationCandidateMode;
  criteriaMode: CtValidationCriteriaMode;
  temporalMode: CtValidationTemporalMode;
  tenantStructure: CtValidationTenantStructure;
  accountIndex: number;
}

export interface CtShadowValidationFinding {
  scenarioId: string;
  invariant: string;
  verdict: CtShadowValidationVerdict;
  message: string;
  evidence?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface CtShadowValidationRun {
  scenario: CtShadowValidationScenario;
  report: CtShadowReport;
  rerun: CtShadowReport;
  findings: readonly CtShadowValidationFinding[];
  deterministic: boolean;
  serializable: boolean;
  durationMs: number;
  previousSnapshot: CtTargetingCriteriaSnapshot | null;
}

export interface CtShadowValidationAggregate {
  scenarioCount: number;
  passCount: number;
  warningCount: number;
  failCount: number;
  passRate: number;
  triggerRateByPlan: Readonly<Record<CtPlan, number>>;
  triggerRateByStock: Readonly<Record<string, number>>;
  averageCandidates: number;
  exclusionRate: number;
  duplicateRate: number;
  blacklistRate: number;
  invalidRate: number;
  averageProposals: number;
  emptyBatchRate: number;
  averageScore: number | null;
  medianScore: number | null;
  scorePercentiles: Readonly<{ p10: number | null; p25: number | null; p75: number | null; p90: number | null }>;
  scoreBands: Readonly<Record<"reject" | "review" | "recommended", number>>;
  batchFillRate: number;
  providerWarningRate: number;
  errorRate: number;
  idempotenceStabilityRate: number;
  snapshotCompatibility: Readonly<Record<string, number>>;
  reasonCodes: Readonly<Record<string, number>>;
  exclusionReasons: Readonly<Record<string, number>>;
}

export interface CtShadowValidationSuite {
  version: "ct-shadow-validation-v1";
  generatedAt: string;
  scenarios: readonly CtShadowValidationScenario[];
  runs: readonly CtShadowValidationRun[];
  aggregate: CtShadowValidationAggregate;
  findings: readonly CtShadowValidationFinding[];
  verdict: CtShadowValidationVerdict;
}

export interface CtShadowQualityThresholds {
  maxInvariantFailures: 0;
  maxCrossAccountLeakage: 0;
  maxActivatableShadowBatches: 0;
  maxOversizedBatches: 0;
  maxDuplicateFinalProposals: 0;
  maxBlacklistedFinalProposals: 0;
  maxActiveTargetsReproposed: 0;
  maxNonDeterministicReruns: 0;
  maxNonSerializableReports: 0;
  maxReasonlessExclusions: 0;
  warningAverageScoreBelow: number;
  warningReviewShareAbove: number;
  warningDuplicateRateAbove: number;
  warningBlacklistRateAbove: number;
}

export interface CtShadowQualityEvaluation {
  verdict: CtShadowValidationVerdict;
  findings: readonly CtShadowValidationFinding[];
  recommendations: readonly string[];
}
