import { FailingCandidateSearchProvider, FixtureCandidateSearchProvider } from "../candidate-search-provider.ts";
import { CT_PREMIUM_PRODUCT_CONFIG } from "../config.ts";
import { runCtPremiumShadowGeneration, type CtShadowPipelineInput } from "../shadow-pipeline.ts";
import { buildCtTargetingCriteriaSnapshot, type CtCanonicalSnapshotInput } from "../snapshot.ts";
import type { AccountId, CtClock, CtIdGenerator, CtProposalCandidate, TenantId } from "../types.ts";
import { evaluateCtShadowInvariants } from "./invariants.ts";
import { aggregateCtShadowValidation } from "./metrics.ts";
import { buildCtShadowValidationScenarios } from "./scenarios.ts";
import type { CtShadowValidationRun, CtShadowValidationScenario, CtShadowValidationSuite } from "./types.ts";

class ValidationClock implements CtClock { now() { return new Date("2026-07-28T12:00:00.000Z"); } }
class ValidationIds implements CtIdGenerator { private sequence = 0; next(kind: "batch" | "proposal" | "snapshot" | "target") { this.sequence += 1; return `${kind}_shadow_validation_${this.sequence}`; } }
const clock = new ValidationClock();

function scope(scenario: CtShadowValidationScenario) {
  const tenantBase = scenario.tenantStructure === "single" ? `tenant_synthetic_single_${scenario.id}` : scenario.tenantStructure === "mixed_agency" ? `tenant_synthetic_mixed_${Math.floor(scenario.accountIndex / 3)}` : `tenant_synthetic_agency_${scenario.id.slice(-2)}`;
  return { tenantId: tenantBase as TenantId, accountId: `account_synthetic_${scenario.tenantStructure}_${scenario.accountIndex}_${scenario.id}` as AccountId };
}

function candidate(username: string, signal: number): CtProposalCandidate {
  return { username, displayName: "Synthetic validation profile", biography: "Synthetic data only", followersCount: 1_500, audienceMatch: signal, languageMatch: signal, geographyMatch: signal, categoryMatch: signal, followerRangeMatch: signal, engagementQuality: signal, profileActivity: signal, sourceTargetPerformance: signal, historicalFollowbackSignal: signal, profileEligibilityConfidence: signal, isEligible: true };
}

function candidatesFor(scenario: CtShadowValidationScenario): readonly CtProposalCandidate[] {
  const prefix = `sv${scenario.id.slice(-3)}`;
  const many = (count: number, signal: number) => Array.from({ length: count }, (_, index) => candidate(`${prefix}_${index + 1}`, signal));
  switch (scenario.candidateMode) {
    case "empty": case "provider_failure": case "interrupted": return [];
    case "three": return many(3, .9);
    case "ten": return many(10, .8);
    case "twenty_five": return many(25, .8);
    case "invalid": return [{ ...candidate("invalid-name!", .9), username: "invalid-name!" }, ...many(4, .8)];
    case "duplicates": { const value = candidate(`${prefix}_duplicate`, .8); return [value, value, ...many(3, .8)]; }
    case "blacklisted": return [candidate(`${prefix}_blacklisted`, .9), ...many(4, .8)];
    case "active": return [candidate(`${prefix}_active`, .9), ...many(4, .8)];
    case "low": return many(10, .25);
    case "medium": return many(10, .6);
    case "high": return many(10, .95);
    case "mixed": return [...many(4, .25), ...Array.from({ length: 4 }, (_, index) => candidate(`${prefix}_medium_${index}`, .6)), ...Array.from({ length: 4 }, (_, index) => candidate(`${prefix}_high_${index}`, .95))];
    case "idempotency_conflict": return many(10, .85);
  }
}

function snapshotInput(scenario: CtShadowValidationScenario, tenantId: TenantId, accountId: AccountId): CtCanonicalSnapshotInput {
  const prefix = `sv${scenario.id.slice(-3)}`;
  const partial = scenario.criteriaMode === "partial";
  const narrow = scenario.criteriaMode === "narrow";
  const activeTargetUsernames = scenario.candidateMode === "active" ? [`${prefix}_active`] : [];
  const blacklistUsernames = scenario.candidateMode === "blacklisted" || scenario.temporalMode === "cooldown_active" ? [`${prefix}_${scenario.candidateMode === "blacklisted" ? "blacklisted" : "1"}`] : [];
  return {
    tenantId, accountId, plan: scenario.plan,
    entitlementIdentity: scenario.lifecycle === "entitlement_replaced" ? "entitlement_synthetic_replaced" : "entitlement_synthetic_v1",
    entitlementVersion: scenario.lifecycle === "entitlement_replaced" ? "v2" : "v1",
    eligibleTargetCount: scenario.stock,
    accountLanguage: scenario.criteriaMode === "broad" ? "en" : "fr",
    targetGeographies: narrow ? ["za"] : ["za", "fr", "gb"],
    targetLanguages: narrow ? ["fr"] : ["fr", "en"],
    categories: narrow ? ["niche_micro"] : ["fitness", "wellness", "lifestyle"],
    followerRange: narrow ? { min: 5_000, max: 7_500 } : { min: 100, max: 100_000 },
    engagementExpectation: narrow ? .7 : .35,
    accountAnalysis: partial ? { completeness: "partial" } : { completeness: "complete", synthetic: true, nicheConfidence: .8 },
    activeTargetUsernames,
    historicalTargetPerformance: scenario.criteriaMode === "strong_history" ? [{ username: `${prefix}_source`, follows: 100, followbacks: 30 }] : scenario.criteriaMode === "weak_history" ? [{ username: `${prefix}_source`, follows: 100, followbacks: 1 }] : [],
    sourceTargetPerformance: scenario.criteriaMode === "strong_history" ? { [`${prefix}_source`]: .9 } : {},
    followbackSignals: scenario.criteriaMode === "strong_followback" ? { [`${prefix}_source`]: .35 } : {},
    skipEligibilitySignals: scenario.criteriaMode === "high_skip" ? { privateProfileRate: .8, skipRisk: "high" } : {},
    blacklistUsernames,
    rejectedCooldownDays: CT_PREMIUM_PRODUCT_CONFIG.rejectionCooldownDays,
    scoringVersion: CT_PREMIUM_PRODUCT_CONFIG.scoringVersion,
    searchStrategyVersion: CT_PREMIUM_PRODUCT_CONFIG.searchStrategyVersion,
    batchSize: CT_PREMIUM_PRODUCT_CONFIG.defaultBatchSize,
    triggerReason: "synthetic_shadow_validation",
    createdAt: clock.now().toISOString(),
  };
}

function pipelineInput(scenario: CtShadowValidationScenario): { input: CtShadowPipelineInput; previousSnapshot: ReturnType<typeof buildCtTargetingCriteriaSnapshot> | null } {
  const { tenantId, accountId } = scope(scenario);
  const snapshot = snapshotInput(scenario, tenantId, accountId);
  const active = scenario.lifecycle === "ready" || scenario.lifecycle === "entitlement_replaced" || scenario.lifecycle === "active_batch";
  const gateInput = {
    tenantId, accountId, plan: scenario.plan,
    premiumEntitlementActive: scenario.plan === "premium" && !["entitlement_absent", "entitlement_expired"].includes(scenario.lifecycle),
    ownershipActive: scenario.lifecycle !== "ownership_inactive", paused: scenario.lifecycle === "paused", canceled: scenario.lifecycle === "canceled", campaignBlocked: scenario.lifecycle === "blocked", lifecycleCompatible: scenario.lifecycle !== "lifecycle_incompatible",
    eligibleTargetCount: scenario.stock,
    onboarding: { status: scenario.lifecycle === "onboarding_incomplete" ? "incomplete" as const : "ready" as const, initialValidTargetCount: scenario.lifecycle === "onboarding_incomplete" ? 14 : 15 },
    existingActiveBatch: scenario.lifecycle === "active_batch" ? { tenantId, accountId, batchId: `batch_synthetic_active_${scenario.id}` } : null,
    clock,
  };
  const provider = scenario.candidateMode === "provider_failure" ? new FailingCandidateSearchProvider(scenario.candidateMode) : new FixtureCandidateSearchProvider(scenario.candidateMode === "interrupted" ? candidatesFor({ ...scenario, candidateMode: "ten" }) : candidatesFor(scenario), clock, "synthetic-validation", "v1");
  let previousSnapshot = null;
  if (scenario.temporalMode.startsWith("snapshot_")) {
    const previousInput = scenario.temporalMode === "snapshot_materially_changed" ? { ...snapshot, targetLanguages: ["de"] } : scenario.temporalMode === "snapshot_compatible" ? { ...snapshot, eligibleTargetCount: Math.min(20, scenario.stock + 1) } : { ...snapshot };
    previousSnapshot = buildCtTargetingCriteriaSnapshot(previousInput, new ValidationIds());
  }
  return { input: { gateInput, snapshotInput: snapshot, provider, clock, ids: new ValidationIds(), activeProposalUsernames: [], previousSnapshots: previousSnapshot ? [previousSnapshot] : undefined, readCurrentGateInput: scenario.candidateMode === "interrupted" && active ? async () => ({ ...gateInput, paused: true }) : undefined }, previousSnapshot };
}

function stableReport(report: Awaited<ReturnType<typeof runCtPremiumShadowGeneration>>) { return JSON.stringify(report); }

export async function runCtShadowValidationScenario(scenario: CtShadowValidationScenario): Promise<CtShadowValidationRun> {
  const first = pipelineInput(scenario);
  const report = await runCtPremiumShadowGeneration(first.input);
  const second = pipelineInput(scenario);
  if (scenario.candidateMode === "idempotency_conflict" && report.shadowBatch) second.input.existingShadowIdempotencyKeys = [report.idempotencyKey];
  const rerun = await runCtPremiumShadowGeneration(second.input);
  const deterministic = scenario.candidateMode === "idempotency_conflict" && report.shadowBatch ? rerun.errors.includes("idempotency_conflict") : stableReport(report) === stableReport(rerun);
  let serializable = true;
  try { JSON.parse(JSON.stringify(report)); } catch { serializable = false; }
  const partial = { scenario, report, rerun, deterministic, serializable, durationMs: Object.values(report.stepDurationsMs).reduce((sum, value) => sum + value, 0), previousSnapshot: first.previousSnapshot };
  const findings = evaluateCtShadowInvariants(partial);
  return Object.freeze({ ...partial, findings });
}

export async function runCtShadowValidationSuite(scenarios = buildCtShadowValidationScenarios()): Promise<CtShadowValidationSuite> {
  const runs: CtShadowValidationRun[] = [];
  for (const scenario of scenarios) runs.push(await runCtShadowValidationScenario(scenario));
  const aggregate = aggregateCtShadowValidation(runs);
  const findings = runs.flatMap((run) => run.findings);
  return Object.freeze({ version: "ct-shadow-validation-v1", generatedAt: clock.now().toISOString(), scenarios, runs: Object.freeze(runs), aggregate, findings: Object.freeze(findings), verdict: findings.some((finding) => finding.verdict === "fail") ? "fail" : findings.some((finding) => finding.verdict === "warning") ? "warning" : "pass" });
}
