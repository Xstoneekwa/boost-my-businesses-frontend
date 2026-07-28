import type { CtShadowValidationScenario, CtValidationCandidateMode, CtValidationCriteriaMode, CtValidationLifecycle, CtValidationTemporalMode, CtValidationTenantStructure } from "./types.ts";

const PLANS = ["growth", "pro", "premium"] as const;
const STOCKS = [0, 1, 5, 6, 14, 15, 20] as const;
const LIFECYCLES: readonly CtValidationLifecycle[] = ["ready", "onboarding_incomplete", "paused", "canceled", "blocked", "active_batch", "ownership_inactive", "lifecycle_incompatible", "entitlement_absent", "entitlement_expired", "entitlement_replaced"];
const CANDIDATES: readonly CtValidationCandidateMode[] = ["empty", "three", "ten", "twenty_five", "invalid", "duplicates", "blacklisted", "active", "low", "medium", "high", "mixed", "provider_failure", "interrupted", "idempotency_conflict"];
const CRITERIA: readonly CtValidationCriteriaMode[] = ["broad", "narrow", "partial", "complete", "strong_history", "weak_history", "strong_followback", "high_skip"];
const TEMPORAL: readonly CtValidationTemporalMode[] = ["before_expiry", "at_expiry", "after_expiry", "cooldown_active", "cooldown_expired", "snapshot_identical", "snapshot_compatible", "snapshot_materially_changed"];
const STRUCTURES: readonly CtValidationTenantStructure[] = ["single", "premium_agency", "mixed_agency", "same_tenant_distinct_criteria"];
type ScenarioSeed = Omit<CtShadowValidationScenario, "id">;

const seed = (overrides: Partial<ScenarioSeed> = {}): ScenarioSeed => ({ plan: "premium", stock: 5, lifecycle: "ready", candidateMode: "mixed", criteriaMode: "complete", temporalMode: "before_expiry", tenantStructure: "single", accountIndex: 0, ...overrides });

export function buildCtShadowValidationScenarios(count = 168): readonly CtShadowValidationScenario[] {
  if (!Number.isInteger(count) || count < 100) throw new Error("shadow_validation_requires_at_least_100_scenarios");
  const matrix: ScenarioSeed[] = [];
  for (const plan of PLANS) for (const stock of STOCKS) matrix.push(seed({ plan, stock, candidateMode: "ten" }));
  for (const lifecycle of LIFECYCLES) for (const plan of PLANS) matrix.push(seed({ lifecycle, plan, candidateMode: "mixed" }));
  for (const candidateMode of CANDIDATES) matrix.push(seed({ candidateMode }));
  for (const criteriaMode of CRITERIA) matrix.push(seed({ criteriaMode }));
  for (const temporalMode of TEMPORAL) matrix.push(seed({ temporalMode, candidateMode: "high" }));
  for (const tenantStructure of STRUCTURES) for (let accountIndex = 0; accountIndex < 3; accountIndex += 1) matrix.push(seed({ tenantStructure, accountIndex, criteriaMode: CRITERIA[(accountIndex + STRUCTURES.indexOf(tenantStructure)) % CRITERIA.length] }));
  const qualityModes: readonly CtValidationCandidateMode[] = ["low", "medium", "high", "mixed", "duplicates", "blacklisted", "active", "invalid", "twenty_five", "three"];
  const qualityStocks = [0, 1, 5] as const;
  for (let index = 0; matrix.length < count; index += 1) matrix.push(seed({ stock: qualityStocks[index % qualityStocks.length], candidateMode: qualityModes[index % qualityModes.length], criteriaMode: CRITERIA[Math.floor(index / qualityModes.length) % CRITERIA.length], temporalMode: TEMPORAL[Math.floor(index / 7) % TEMPORAL.length], tenantStructure: STRUCTURES[index % STRUCTURES.length], accountIndex: index % 3 }));
  return Object.freeze(matrix.slice(0, count).map((value, index) => Object.freeze({ id: `ct_shadow_scenario_${String(index + 1).padStart(3, "0")}`, ...value })));
}

export const CT_SHADOW_VALIDATION_SCENARIOS = buildCtShadowValidationScenarios();
