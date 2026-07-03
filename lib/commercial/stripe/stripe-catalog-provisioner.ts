import {
  buildStripePublicPricesManifest,
  buildStripePublicProductsManifest,
  type StripePublicPriceManifestEntry,
  type StripePublicProductManifestEntry,
} from "./stripe-public-catalog-manifest.ts";
import type { StripeCatalogEnvironment } from "./stripe-catalog.ts";

export type ProvisionerMode = "dry_run" | "apply";

export type StripeCatalogProvisionerInput = {
  environment: StripeCatalogEnvironment;
  mode?: ProvisionerMode;
  secretKeyPrefix?: string;
};

export type StripeCatalogProvisionerPlan = {
  environment: StripeCatalogEnvironment;
  mode: ProvisionerMode;
  products: StripePublicProductManifestEntry[];
  prices: StripePublicPriceManifestEntry[];
  wouldCreateProducts: number;
  wouldCreatePrices: number;
  dbWritesEnabled: boolean;
};

export function assertProvisionerKeyMatchesEnvironment(input: {
  environment: StripeCatalogEnvironment;
  secretKeyPrefix?: string;
}) {
  const prefix = String(input.secretKeyPrefix ?? "").trim();
  if (!prefix) return { ok: true as const };
  if (input.environment === "test" && prefix !== "sk_test") {
    return { ok: false as const, code: "test_environment_requires_test_key" as const };
  }
  if (input.environment === "live" && prefix !== "sk_live") {
    return { ok: false as const, code: "live_environment_requires_live_key" as const };
  }
  return { ok: true as const };
}

export function buildStripeCatalogProvisionerPlan(
  input: StripeCatalogProvisionerInput,
): StripeCatalogProvisionerPlan | { ok: false; code: string } {
  const keyCheck = assertProvisionerKeyMatchesEnvironment(input);
  if (!keyCheck.ok) return keyCheck;
  const mode = input.mode ?? "dry_run";
  const products = buildStripePublicProductsManifest();
  const prices = buildStripePublicPricesManifest();
  return {
    environment: input.environment,
    mode,
    products,
    prices,
    wouldCreateProducts: products.length,
    wouldCreatePrices: prices.length,
    dbWritesEnabled: mode === "apply",
  };
}

export function redactProvisionerReport(plan: StripeCatalogProvisionerPlan) {
  return {
    environment: plan.environment,
    mode: plan.mode,
    productCount: plan.products.length,
    priceCount: plan.prices.length,
    productNames: plan.products.map((product) => product.name),
    dbWritesEnabled: plan.dbWritesEnabled,
  };
}
