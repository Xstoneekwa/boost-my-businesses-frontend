import { CT_PREMIUM_PRODUCT_CONFIG, type CtPremiumProductConfig } from "./config.ts";
import type { AccountId, CtClock, CtPlan, TenantId } from "./types.ts";

export type CtLowStockGateAction =
  | "no_action"
  | "request_client_targets"
  | "prepare_premium_batch"
  | "batch_already_active"
  | "blocked"
  | "onboarding_incomplete";

export type CtLowStockGateReason =
  | "stock_above_threshold"
  | "low_stock_growth"
  | "low_stock_pro"
  | "low_stock_premium"
  | "active_batch_exists"
  | "premium_entitlement_inactive"
  | "ownership_inactive"
  | "account_paused"
  | "account_canceled"
  | "campaign_blocked"
  | "lifecycle_incompatible"
  | "onboarding_incomplete"
  | "onboarding_minimum_not_met"
  | "cross_account_access";

export interface CtActiveBatchScope {
  tenantId: TenantId;
  accountId: AccountId;
  batchId: string;
}

export interface CtLowStockGateInput {
  tenantId: TenantId;
  accountId: AccountId;
  plan: CtPlan;
  premiumEntitlementActive: boolean;
  ownershipActive: boolean;
  paused: boolean;
  canceled: boolean;
  campaignBlocked: boolean;
  lifecycleCompatible: boolean;
  eligibleTargetCount: number;
  onboarding: Readonly<{ status: "incomplete" | "ready"; initialValidTargetCount: number }>;
  existingActiveBatch: CtActiveBatchScope | null;
  clock: CtClock;
  config?: Readonly<CtPremiumProductConfig>;
}

export interface CtLowStockGateDecision {
  tenantId: TenantId;
  accountId: AccountId;
  action: CtLowStockGateAction;
  reason: CtLowStockGateReason;
  reasonCode: CtLowStockGateReason;
  triggered: boolean;
  eligibleTargetCount: number;
  currentEligibleCount: number;
  threshold: number;
  snapshotRequired: boolean;
  shadowGenerationAllowed: boolean;
  clientActionRequired: boolean;
  generationBlocked: boolean;
  explanation: string;
  evaluatedAt: string;
  activeBatchId: string | null;
}

export function evaluateCtLowStockGate(input: CtLowStockGateInput): CtLowStockGateDecision {
  const config = input.config ?? CT_PREMIUM_PRODUCT_CONFIG;
  const finish = (action: CtLowStockGateAction, reason: CtLowStockGateReason): CtLowStockGateDecision => Object.freeze({
    tenantId: input.tenantId,
    accountId: input.accountId,
    action,
    reason,
    reasonCode: reason,
    triggered: input.eligibleTargetCount <= config.lowStockThreshold && action !== "onboarding_incomplete" && action !== "no_action",
    eligibleTargetCount: Math.max(0, Math.trunc(input.eligibleTargetCount)),
    currentEligibleCount: Math.max(0, Math.trunc(input.eligibleTargetCount)),
    threshold: config.lowStockThreshold,
    snapshotRequired: action === "prepare_premium_batch",
    shadowGenerationAllowed: action === "prepare_premium_batch",
    clientActionRequired: action === "request_client_targets",
    generationBlocked: action === "blocked" || action === "onboarding_incomplete" || action === "batch_already_active",
    explanation: reason,
    evaluatedAt: input.clock.now().toISOString(),
    activeBatchId: input.existingActiveBatch?.batchId ?? null,
  });

  if (!input.ownershipActive) return finish("blocked", "ownership_inactive");
  if (input.paused) return finish("blocked", "account_paused");
  if (input.canceled) return finish("blocked", "account_canceled");
  if (input.campaignBlocked) return finish("blocked", "campaign_blocked");
  if (!input.lifecycleCompatible) return finish("blocked", "lifecycle_incompatible");
  if (input.onboarding.status !== "ready") return finish("onboarding_incomplete", "onboarding_incomplete");
  if (input.onboarding.initialValidTargetCount < config.onboardingMinimumValidTargets) {
    return finish("onboarding_incomplete", "onboarding_minimum_not_met");
  }
  if (input.eligibleTargetCount > config.lowStockThreshold) return finish("no_action", "stock_above_threshold");
  if (input.existingActiveBatch) {
    if (input.existingActiveBatch.tenantId !== input.tenantId || input.existingActiveBatch.accountId !== input.accountId) {
      return finish("blocked", "cross_account_access");
    }
    return finish("batch_already_active", "active_batch_exists");
  }
  if (input.plan === "growth") return finish("request_client_targets", "low_stock_growth");
  if (input.plan === "pro") return finish("request_client_targets", "low_stock_pro");
  if (!input.premiumEntitlementActive) return finish("blocked", "premium_entitlement_inactive");
  return finish("prepare_premium_batch", "low_stock_premium");
}
