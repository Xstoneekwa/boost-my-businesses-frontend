export const TARGET_LIFECYCLE_THRESHOLD_VERSION = "target-lifecycle-v1";

export interface TargetLifecycleThresholds {
  watchRatio: number;
  replacementRatio: number;
  replacementPendingRatio: number;
  exhaustedRatio: number;
  terminalConfirmationRatio: number;
  minimumHighConfidence: number;
  freshnessDays: number;
}

export const TARGET_LIFECYCLE_THRESHOLDS: Readonly<TargetLifecycleThresholds> = Object.freeze({
  watchRatio: 0.75,
  replacementRatio: 0.8,
  replacementPendingRatio: 0.85,
  exhaustedRatio: 0.9,
  terminalConfirmationRatio: 0.95,
  minimumHighConfidence: 0.8,
  freshnessDays: 14,
});

export function minimumEvaluatedProfilesForAudience(audience: number | null): number {
  if (audience === null || audience <= 0) return 0;
  if (audience < 500) return 250;
  if (audience < 2_000) return 500;
  if (audience < 10_000) return 1_000;
  return 2_500;
}
