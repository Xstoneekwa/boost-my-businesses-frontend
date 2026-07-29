import type { TargetAvailabilityAssessment, TargetLifecycleScope } from "./types.ts";
import type { TargetPerformanceShadowState } from "./performance-shadow.ts";
import type { TargetUtilizationShadowState } from "./utilization-shadow.ts";

export type TargetLifecycleShadowRecommendation =
  | "monitor"
  | "recheck_availability"
  | "operator_identity_review"
  | "replacement_recommended"
  | "replacement_preparation_recommended"
  | "insufficient_evidence";

export function assessTargetLifecycleShadow(input: Readonly<{
  scope: TargetLifecycleScope;
  availability: TargetAvailabilityAssessment;
  utilizationState: TargetUtilizationShadowState;
  performanceState: TargetPerformanceShadowState;
  replacementPending?: boolean;
  blockers?: readonly string[];
  calculatedAt: string;
}>) {
  let recommendation: TargetLifecycleShadowRecommendation = "monitor";
  const reasons: string[] = [...input.availability.reasons];
  if (input.availability.status === "identity_conflict") recommendation = "operator_identity_review";
  else if (input.availability.recheckRequired) recommendation = "recheck_availability";
  else if (input.availability.replacementRequired || input.utilizationState === "exhausted") recommendation = "replacement_recommended";
  else if (input.replacementPending || ["replacement_recommended", "replacement_pending"].includes(input.utilizationState)) recommendation = "replacement_preparation_recommended";
  else if (["insufficient_data", "stale_data"].includes(input.utilizationState) || ["insufficient", "stale"].includes(input.performanceState)) recommendation = "insufficient_evidence";
  else if (input.performanceState === "underperforming") reasons.push("performance_underperforming_not_terminal");
  const blockers = Object.freeze([...(input.blockers ?? [])]);
  const primaryReason = reasons[0] ?? "target_availability_unknown";
  const evidenceFreshness = input.availability.status === "stale_evidence"
    ? "stale"
    : input.availability.latestObservedAt ? "fresh" : "unknown";
  const recommendedNextObservation = recommendation === "recheck_availability"
    ? "collect_next_healthy_cross_run_observation"
    : recommendation === "operator_identity_review"
      ? "collect_stable_identity_evidence"
      : recommendation === "insufficient_evidence"
        ? "collect_minimum_volume"
        : "continue_passive_observation";
  return Object.freeze({
    mode: "shadow" as const,
    mutationExecuted: false as const,
    scope: Object.freeze({ ...input.scope }),
    availabilityStatus: input.availability.status,
    utilizationState: input.utilizationState,
    performanceState: input.performanceState,
    recommendation,
    reasons: Object.freeze(reasons),
    explanation: `availability=${input.availability.status}; utilization=${input.utilizationState}; performance=${input.performanceState}; recommendation=${recommendation}`,
    explanationStructured: Object.freeze({
      primaryReason,
      secondaryReasons: Object.freeze(reasons.slice(1)),
      confidence: input.availability.confidence,
      evidenceFreshness,
      blockers,
      recommendedNextObservation,
      policyPreview: recommendation,
    }),
    calculatedAt: input.calculatedAt,
  });
}
