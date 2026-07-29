import type { TargetPlan } from "./types.ts";
import type { TargetLifecycleShadowRecommendation } from "./lifecycle-shadow.ts";

export type TargetPolicyShadowInput = Readonly<{
  plan: TargetPlan;
  recommendation: TargetLifecycleShadowRecommendation;
  accountId: string;
  packageActive: boolean;
  entitlementActive: boolean;
  ownershipValid: boolean;
  onboardingComplete: boolean;
  accountPaused: boolean;
  cancelRequested: boolean;
  downgradePending: boolean;
  campaignBlocked: boolean;
  targetBlacklisted: boolean;
  replacementStockAvailable: boolean;
  evaluatedAt: string;
}>;

export function evaluateTargetPolicyShadow(input: TargetPolicyShadowInput) {
  const blockers: string[] = [];
  if (!input.packageActive) blockers.push("package_inactive");
  if (!input.entitlementActive) blockers.push("entitlement_inactive");
  if (!input.ownershipValid) blockers.push("ownership_invalid");
  if (!input.onboardingComplete) blockers.push("onboarding_incomplete");
  if (input.accountPaused) blockers.push("account_paused");
  if (input.cancelRequested) blockers.push("cancel_requested");
  if (input.downgradePending) blockers.push("downgrade_pending");
  if (input.campaignBlocked) blockers.push("campaign_blocked");
  if (input.targetBlacklisted) blockers.push("target_blacklisted");
  let action = "monitor";
  if (blockers.length) action = "blocked";
  else if (["replacement_recommended", "replacement_preparation_recommended"].includes(input.recommendation)) {
    if (input.plan === "premium") action = input.replacementStockAvailable
      ? "automatic_replacement_preparation_recommended"
      : "premium_replacement_stock_required";
    else action = "client_target_request_recommended";
  } else if (input.recommendation === "operator_identity_review") action = "operator_review_recommended";
  else if (input.recommendation === "recheck_availability") action = "availability_recheck_recommended";
  return Object.freeze({
    mode: "policy_shadow" as const,
    mutationExecuted: false as const,
    action,
    blockers: Object.freeze(blockers),
    automaticActionAllowed: false as const,
    notificationSent: false as const,
    emailSent: false as const,
    evaluatedAt: input.evaluatedAt,
  });
}
