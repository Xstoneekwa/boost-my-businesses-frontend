import {
  COMMERCIAL_CATALOG_VERSION,
  COMMERCIAL_PLANS,
  OUTREACH_ADDONS,
  type BillingIntervalMonths,
  type OutreachAddonKey,
  type PlanKey,
} from "../catalog.ts";
import {
  productKeyForOutreach,
  productKeyForPackage,
  publicCatalogAmountCents,
  type ProductKey,
  type StripeComponentKind,
} from "./stripe-per-entitlement-billing.ts";

export const STRIPE_PUBLIC_CATALOG_VERSION = `stripe-public-${COMMERCIAL_CATALOG_VERSION}`;

export type StripePublicProductManifestEntry = {
  productKey: ProductKey;
  name: string;
  componentKind: StripeComponentKind;
  packageKey: PlanKey | null;
  outreachKey: OutreachAddonKey | null;
  catalogVersion: string;
};

export type StripePublicPriceManifestEntry = StripePublicProductManifestEntry & {
  deterministicKey: string;
  billingIntervalMonths: BillingIntervalMonths;
  currency: "eur";
  recurringInterval: "month";
  recurringIntervalCount: BillingIntervalMonths;
  unitAmountCents: number;
};

export const STRIPE_PUBLIC_PRODUCT_NAMES: Record<ProductKey, string> = {
  boost_ai_growth: "Boost AI — Growth",
  boost_ai_pro: "Boost AI — Pro",
  boost_ai_premium: "Boost AI — Premium",
  instagram_outreach_standard: "Instagram Outreach — Standard",
  instagram_outreach_ai: "Instagram Outreach — AI",
};

export const STRIPE_PUBLIC_INTERVALS: BillingIntervalMonths[] = [1, 3, 6, 12];

export function buildStripePublicProductsManifest(): StripePublicProductManifestEntry[] {
  const packageProducts = (Object.keys(COMMERCIAL_PLANS) as PlanKey[]).map((packageKey) => {
    const productKey = productKeyForPackage(packageKey);
    return {
      productKey,
      name: STRIPE_PUBLIC_PRODUCT_NAMES[productKey],
      componentKind: "package" as const,
      packageKey,
      outreachKey: null,
      catalogVersion: COMMERCIAL_CATALOG_VERSION,
    };
  });
  const outreachProducts = (Object.keys(OUTREACH_ADDONS) as OutreachAddonKey[]).map((outreachKey) => {
    const productKey = productKeyForOutreach(outreachKey);
    return {
      productKey,
      name: STRIPE_PUBLIC_PRODUCT_NAMES[productKey],
      componentKind: "outreach" as const,
      packageKey: null,
      outreachKey,
      catalogVersion: COMMERCIAL_CATALOG_VERSION,
    };
  });
  return [...packageProducts, ...outreachProducts];
}

export function buildStripePublicPricesManifest(): StripePublicPriceManifestEntry[] {
  return buildStripePublicProductsManifest().flatMap((product) => (
    STRIPE_PUBLIC_INTERVALS.map((billingIntervalMonths) => {
      const catalogKey = product.packageKey ?? product.outreachKey;
      if (!catalogKey) {
        throw new Error("stripe_public_product_key_missing");
      }
      return {
        ...product,
        deterministicKey: [
          STRIPE_PUBLIC_CATALOG_VERSION,
          product.productKey,
          `${billingIntervalMonths}m`,
        ].join(":"),
        billingIntervalMonths,
        currency: "eur" as const,
        recurringInterval: "month" as const,
        recurringIntervalCount: billingIntervalMonths,
        unitAmountCents: publicCatalogAmountCents(
          product.componentKind,
          catalogKey,
          billingIntervalMonths,
        ),
      };
    })
  ));
}

export function assertStripePublicCatalogShape() {
  const products = buildStripePublicProductsManifest();
  const prices = buildStripePublicPricesManifest();
  const names = products.map((product) => product.name);
  const uniqueNames = new Set(names);
  const uniquePrices = new Set(prices.map((price) => price.deterministicKey));
  return {
    ok: products.length === 5
      && prices.length === 20
      && uniqueNames.size === 5
      && uniquePrices.size === 20
      && prices.every((price) => price.unitAmountCents > 0 && price.currency === "eur"),
    productCount: products.length,
    priceCount: prices.length,
    productNames: names,
  };
}
