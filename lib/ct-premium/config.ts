import { CT_SCORING_V1 } from "./scoring.ts";
import type { CtBatchBuildConfig } from "./types.ts";

export interface CtPremiumProductConfig {
  onboardingMinimumValidTargets: 15;
  lowStockThreshold: 5;
  defaultBatchSize: 10;
  maxBatchSize: 20;
  rejectionCooldownDays: 30;
  reviewDurationDays: 5;
  scoringVersion: string;
  searchStrategyVersion: string;
}

export const CT_PREMIUM_PRODUCT_CONFIG: Readonly<CtPremiumProductConfig> = Object.freeze({
  onboardingMinimumValidTargets: 15,
  lowStockThreshold: 5,
  defaultBatchSize: 10,
  maxBatchSize: 20,
  rejectionCooldownDays: 30,
  reviewDurationDays: 5,
  scoringVersion: CT_SCORING_V1.version,
  searchStrategyVersion: "ct-premium-search-v1",
});

export function resolveCtBatchSize(requested: number | undefined, product = CT_PREMIUM_PRODUCT_CONFIG) {
  if (requested === undefined) return product.defaultBatchSize;
  if (!Number.isFinite(requested)) return product.defaultBatchSize;
  return Math.min(product.maxBatchSize, Math.max(1, Math.trunc(requested)));
}

export function defaultCtBatchBuildConfig(requestedBatchSize?: number): CtBatchBuildConfig {
  return { maxProposals: resolveCtBatchSize(requestedBatchSize), scoring: CT_SCORING_V1 };
}
