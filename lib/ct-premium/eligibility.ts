import type { CtAccountRuntimeState, CtCommercialState, CtEligibilityResult } from "./types.ts";

export function evaluateGenerationEligibility(
  commercial: CtCommercialState,
  runtime: CtAccountRuntimeState,
): CtEligibilityResult {
  const reasons: CtEligibilityResult["reasons"][number][] = [];
  if (!runtime.exists) reasons.push("account_not_found");
  if (!runtime.ownershipActive) reasons.push("account_not_owned");
  if (commercial.plan !== "premium" || !commercial.premiumEntitlementActive || !commercial.entitlementId) reasons.push("premium_required");
  if (runtime.paused) reasons.push("account_paused");
  if (runtime.canceled) reasons.push("account_canceled");
  if (runtime.campaignBlocked) reasons.push("campaign_blocked");
  if (!runtime.lifecycleCompatible) reasons.push("lifecycle_incompatible");
  if (runtime.eligibleTargetCount > 5) reasons.push("stock_above_trigger");
  return { eligible: reasons.length === 0, reasons };
}

export function evaluateDecisionEligibility(commercial: CtCommercialState, runtime: CtAccountRuntimeState) {
  const generation = evaluateGenerationEligibility(commercial, { ...runtime, eligibleTargetCount: Math.min(runtime.eligibleTargetCount, 5) });
  return { eligible: generation.eligible, reasons: generation.reasons.filter((reason) => reason !== "stock_above_trigger") };
}
