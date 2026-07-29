import { assessTargetLifecycle } from "./assessment.ts";
import type { TargetLifecycleAssessmentInput } from "./types.ts";

export type TargetUtilizationShadowState =
  | "healthy"
  | "watch"
  | "replacement_recommended"
  | "replacement_pending"
  | "exhausted"
  | "insufficient_data"
  | "stale_data";

export function assessTargetUtilizationShadow(input: TargetLifecycleAssessmentInput) {
  const assessment = assessTargetLifecycle(input);
  const state: TargetUtilizationShadowState = assessment.status === "insufficient_data"
    ? "insufficient_data"
    : assessment.status === "stale_data"
      ? "stale_data"
      : assessment.status === "archived"
        ? "exhausted"
        : assessment.status;
  return Object.freeze({
    mode: "shadow" as const,
    mutationExecuted: false as const,
    state,
    uniqueProfilesEvaluated: assessment.metrics.uniqueProfilesEvaluated,
    estimatedExploitableAudience: assessment.metrics.denominator.value,
    denominatorConfidence: assessment.confidence.level,
    utilizationRatio: assessment.metrics.utilizationRatio,
    reasons: assessment.reasons,
    assessment,
  });
}
