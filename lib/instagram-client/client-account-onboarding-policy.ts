export const CLIENT_ONBOARDING_TARGET_MINIMUM = 15;

export function hasClientOnboardingTargetMinimum(eligibleCount: number) {
  return Number.isFinite(eligibleCount) && eligibleCount >= CLIENT_ONBOARDING_TARGET_MINIMUM;
}
