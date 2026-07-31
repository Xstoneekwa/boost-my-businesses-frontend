import type { TargetLifecycleScope, TargetLifecycleStatus } from "./types.ts";

export const TARGET_LIFECYCLE_ENGINE_VERSION = "target-lifecycle-global-shadow-v1";
export const TARGET_LIFECYCLE_RULE_VERSION = "target-lifecycle-priority-v1";
export const TARGET_LIFECYCLE_POLICY_VERSION = "target-lifecycle-no-action-v1";
export const TARGET_LIFECYCLE_ENGINE_REVISION = 1;
export const TARGET_LIFECYCLE_POLICY_REVISION = 1;
export const BUSINESS_ACTION_GATE = false as const;

export type TargetLifecycleAvailabilityState =
  | "healthy"
  | "watch"
  | "unavailable_confirmed"
  | "identity_ambiguous"
  | "stale"
  | "insufficient";

export type TargetLifecyclePerformanceState =
  | "healthy"
  | "watch"
  | "low_performance"
  | "stale"
  | "insufficient";

export type TargetLifecycleUtilizationState =
  | "healthy"
  | "watch"
  | "replacement_recommended"
  | "replacement_pending"
  | "exhausted"
  | "stale_data"
  | "insufficient_data";

export type TargetLifecycleRecommendedAction =
  | "monitor"
  | "collect_more_evidence"
  | "recheck_stale_evidence"
  | "operator_identity_review"
  | "replacement_review";

export type TargetLifecycleAvailabilityInput = Readonly<{
  assessmentId: string | null;
  status: string;
  identityStatus: string;
  confidence: "unknown" | "low" | "medium" | "high";
  latestObservationAt: string | null;
  validUntil: string | null;
  terminalProof: boolean;
  reasonCodes: readonly string[];
}>;

export type TargetLifecyclePerformanceInput = Readonly<{
  sourceObservationId: string | null;
  follows: number;
  followbacks: number;
  skips: number;
  errors: number;
  fbrPercent: number | null;
  reliability: "verified" | "strong" | "estimated" | "unknown";
  observedAt: string | null;
}>;

export type TargetLifecycleUtilizationInput = Readonly<{
  state: TargetLifecycleUtilizationState;
  uniqueProfilesEvaluated: number;
  estimatedExploitableAudience: number | null;
  utilizationRatio: number | null;
  observedAt: string | null;
  terminalProof: boolean;
  reasonCodes: readonly string[];
}>;

export type TargetLifecycleGlobalShadowInput = Readonly<{
  scope: TargetLifecycleScope;
  archived: boolean;
  replacementPending: boolean;
  availability: TargetLifecycleAvailabilityInput | null;
  performance: TargetLifecyclePerformanceInput | null;
  utilization: TargetLifecycleUtilizationInput;
  calculatedAt: string;
  staleAfterDays?: number;
  meaningfulFollowMinimum?: number;
  lowFbrThresholdPercent?: number;
}>;

export type TargetLifecycleGlobalShadowAssessment = Readonly<{
  mode: "global_shadow";
  scope: TargetLifecycleScope;
  status: TargetLifecycleStatus;
  availabilityStatus: TargetLifecycleAvailabilityState;
  performanceStatus: TargetLifecyclePerformanceState;
  utilizationStatus: TargetLifecycleUtilizationState;
  confidence: "unknown" | "low" | "medium" | "high";
  reasonCodes: readonly string[];
  missingEvidence: readonly string[];
  recommendedAction: TargetLifecycleRecommendedAction;
  sourceMaxObservedAt: string;
  calculatedAt: string;
  validUntil: string;
  engineVersion: string;
  ruleVersion: string;
  policyVersion: string;
  engineRevision: number;
  policyRevision: number;
  enforcementAllowed: false;
  businessActionAllowed: false;
  mutationExecuted: false;
}>;

const CONFIRMED_UNAVAILABLE = new Set([
  "unavailable_confirmed",
  "verified_restricted_confirmed",
  "permanently_unavailable",
  "suspended_or_disabled",
  "deleted_or_not_found",
  "verified_restricted",
  "followers_surface_restricted",
]);

const EXPLICITLY_CONFIRMED_UNAVAILABLE = new Set([
  "unavailable_confirmed",
  "verified_restricted_confirmed",
]);

const HEALTHY_AVAILABILITY = new Set([
  "available",
  "username_changed",
  "identity_changed",
]);

const WATCH_AVAILABILITY = new Set([
  "likely_available",
  "temporarily_unavailable",
  "unavailable_suspected",
  "verified_restricted_suspected",
]);

const STALE_AVAILABILITY = new Set([
  "stale",
  "stale_evidence",
]);

const IDENTITY_AMBIGUOUS = new Set([
  "identity_conflict",
  "identity_ambiguous",
  "username_change_suspected",
  "stable_id_missing",
]);

const validDate = (value: string | null | undefined) => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
};

const normalizeScope = (scope: TargetLifecycleScope): TargetLifecycleScope => Object.freeze({
  tenantId: scope.tenantId.trim().toLowerCase(),
  accountId: scope.accountId.trim().toLowerCase(),
  targetId: scope.targetId.trim().toLowerCase(),
  normalizedUsername: scope.normalizedUsername.trim().replace(/^@+/, "").toLowerCase(),
});

function availabilityState(
  input: TargetLifecycleAvailabilityInput | null,
  calculatedAtMs: number,
  staleAfterMs: number,
): TargetLifecycleAvailabilityState {
  if (!input) return "insufficient";
  if (IDENTITY_AMBIGUOUS.has(input.status) || IDENTITY_AMBIGUOUS.has(input.identityStatus)) return "identity_ambiguous";
  const latestAt = validDate(input.latestObservationAt);
  const validUntil = validDate(input.validUntil);
  if (STALE_AVAILABILITY.has(input.status) || latestAt === null
    || calculatedAtMs - latestAt > staleAfterMs || validUntil !== null && validUntil < calculatedAtMs) return "stale";
  if (CONFIRMED_UNAVAILABLE.has(input.status)) {
    return EXPLICITLY_CONFIRMED_UNAVAILABLE.has(input.status) || input.terminalProof
      || input.confidence === "high" || input.confidence === "medium"
      ? "unavailable_confirmed"
      : "watch";
  }
  if (HEALTHY_AVAILABILITY.has(input.status)) return "healthy";
  if (WATCH_AVAILABILITY.has(input.status)) return "watch";
  return "insufficient";
}

function performanceState(
  input: TargetLifecyclePerformanceInput | null,
  calculatedAtMs: number,
  staleAfterMs: number,
  meaningfulFollowMinimum: number,
  lowFbrThresholdPercent: number,
): TargetLifecyclePerformanceState {
  if (!input) return "insufficient";
  const observedAt = validDate(input.observedAt);
  if (observedAt === null || calculatedAtMs - observedAt > staleAfterMs) return "stale";
  if (!Number.isInteger(input.follows) || input.follows < 0 || !Number.isInteger(input.followbacks)
    || input.followbacks < 0 || input.followbacks > input.follows || !Number.isInteger(input.skips)
    || input.skips < 0 || !Number.isInteger(input.errors) || input.errors < 0) return "insufficient";
  if (!(["verified", "strong"] as const).includes(input.reliability as "verified" | "strong")) return "insufficient";
  if (input.follows < meaningfulFollowMinimum || input.fbrPercent === null
    || !Number.isFinite(input.fbrPercent) || input.fbrPercent < 0) return "insufficient";
  if (input.fbrPercent < lowFbrThresholdPercent) return "low_performance";
  return "healthy";
}

const observedDates = (input: TargetLifecycleGlobalShadowInput) => [
  input.availability?.latestObservationAt,
  input.performance?.observedAt,
  input.utilization.observedAt,
].map(validDate).filter((value): value is number => value !== null);

const confidence = (
  availability: TargetLifecycleAvailabilityState,
  performance: TargetLifecyclePerformanceState,
  utilization: TargetLifecycleUtilizationState,
): "unknown" | "low" | "medium" | "high" => {
  const insufficient = [availability, performance, utilization]
    .filter((value) => ["insufficient", "insufficient_data"].includes(value)).length;
  const stale = [availability, performance, utilization]
    .filter((value) => ["stale", "stale_data"].includes(value)).length;
  if (insufficient >= 2) return "unknown";
  if (insufficient || stale) return "low";
  if (availability === "watch" || performance === "watch" || utilization === "watch") return "medium";
  return "high";
};

export function assessTargetLifecycleGlobalShadow(
  input: TargetLifecycleGlobalShadowInput,
): TargetLifecycleGlobalShadowAssessment {
  const calculatedAtMs = validDate(input.calculatedAt);
  if (calculatedAtMs === null) throw new Error("target_lifecycle_calculated_at_invalid");
  const staleAfterDays = Math.max(1, Math.min(90, Math.trunc(input.staleAfterDays ?? 14)));
  const staleAfterMs = staleAfterDays * 86_400_000;
  const meaningfulFollowMinimum = Math.max(100, Math.trunc(input.meaningfulFollowMinimum ?? 100));
  const lowFbrThresholdPercent = Math.max(0, Math.min(100, input.lowFbrThresholdPercent ?? 8));
  const availability = availabilityState(input.availability, calculatedAtMs, staleAfterMs);
  const performance = performanceState(
    input.performance,
    calculatedAtMs,
    staleAfterMs,
    meaningfulFollowMinimum,
    lowFbrThresholdPercent,
  );
  const utilization = input.utilization.state;
  const reasons: string[] = [];
  const missingEvidence: string[] = [];
  let status: TargetLifecycleStatus;
  let recommendedAction: TargetLifecycleRecommendedAction;

  if (input.archived) {
    status = "archived";
    recommendedAction = "monitor";
    reasons.push("target_archived_source_truth");
  } else if (availability === "identity_ambiguous") {
    status = "insufficient_data";
    recommendedAction = "operator_identity_review";
    reasons.push("identity_ambiguity_fail_closed");
    missingEvidence.push("stable_identity_confirmation");
  } else if (availability === "unavailable_confirmed") {
    status = input.replacementPending ? "replacement_pending" : "replacement_recommended";
    recommendedAction = "replacement_review";
    reasons.push("availability_unavailable_confirmed");
  } else if (input.replacementPending) {
    status = "replacement_pending";
    recommendedAction = "replacement_review";
    reasons.push("replacement_already_pending");
  } else if (utilization === "exhausted") {
    status = "exhausted";
    recommendedAction = "replacement_review";
    reasons.push("utilization_exhausted");
  } else if (utilization === "replacement_pending") {
    status = "replacement_pending";
    recommendedAction = "replacement_review";
    reasons.push("utilization_replacement_pending");
  } else if (utilization === "replacement_recommended") {
    status = "replacement_recommended";
    recommendedAction = "replacement_review";
    reasons.push("utilization_replacement_recommended");
  } else if (performance === "low_performance") {
    status = "replacement_recommended";
    recommendedAction = "replacement_review";
    reasons.push("performance_low_fbr_confirmed");
  } else if (availability === "stale" || performance === "stale" || utilization === "stale_data") {
    status = "stale_data";
    recommendedAction = "recheck_stale_evidence";
    reasons.push("lifecycle_source_evidence_stale");
  } else if (availability === "insufficient" || performance === "insufficient" || utilization === "insufficient_data") {
    status = "insufficient_data";
    recommendedAction = "collect_more_evidence";
    reasons.push("lifecycle_source_evidence_insufficient");
    if (availability === "insufficient") missingEvidence.push("availability");
    if (performance === "insufficient") missingEvidence.push("performance");
    if (utilization === "insufficient_data") missingEvidence.push("utilization");
  } else if (availability === "watch" || performance === "watch" || utilization === "watch") {
    status = "watch";
    recommendedAction = "monitor";
    reasons.push("lifecycle_watch_signal");
  } else {
    status = "healthy";
    recommendedAction = "monitor";
    reasons.push("target_healthy");
  }

  for (const reason of input.availability?.reasonCodes ?? []) if (reason && !reasons.includes(reason)) reasons.push(reason);
  for (const reason of input.utilization.reasonCodes) if (reason && !reasons.includes(reason)) reasons.push(reason);
  const sourceTimes = observedDates(input);
  const sourceMaxObservedAt = new Date(sourceTimes.length ? Math.max(...sourceTimes) : calculatedAtMs).toISOString();
  const validUntil = new Date((sourceTimes.length ? Math.min(...sourceTimes) : calculatedAtMs) + staleAfterMs).toISOString();
  return Object.freeze({
    mode: "global_shadow",
    scope: normalizeScope(input.scope),
    status,
    availabilityStatus: availability,
    performanceStatus: performance,
    utilizationStatus: utilization,
    confidence: confidence(availability, performance, utilization),
    reasonCodes: Object.freeze([...new Set(reasons)].slice(0, 32)),
    missingEvidence: Object.freeze([...new Set(missingEvidence)]),
    recommendedAction,
    sourceMaxObservedAt,
    calculatedAt: new Date(calculatedAtMs).toISOString(),
    validUntil,
    engineVersion: TARGET_LIFECYCLE_ENGINE_VERSION,
    ruleVersion: TARGET_LIFECYCLE_RULE_VERSION,
    policyVersion: TARGET_LIFECYCLE_POLICY_VERSION,
    engineRevision: TARGET_LIFECYCLE_ENGINE_REVISION,
    policyRevision: TARGET_LIFECYCLE_POLICY_REVISION,
    enforcementAllowed: BUSINESS_ACTION_GATE,
    businessActionAllowed: BUSINESS_ACTION_GATE,
    mutationExecuted: BUSINESS_ACTION_GATE,
  });
}
