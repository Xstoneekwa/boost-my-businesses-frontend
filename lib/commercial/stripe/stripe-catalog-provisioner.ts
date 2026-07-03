import {
  buildStripePublicPricesManifest,
  buildStripePublicProductsManifest,
  type StripePublicPriceManifestEntry,
  type StripePublicProductManifestEntry,
} from "./stripe-public-catalog-manifest.ts";
import type { StripeCatalogEnvironment } from "./stripe-catalog.ts";
import { isStripeLiveSecretKey, isStripeTestSecretKey } from "./stripe-config.ts";

export type ProvisionerMode = "dry_run" | "apply";

export type StripeCatalogProvisionerInput = {
  environment: StripeCatalogEnvironment;
  mode?: ProvisionerMode;
  secretKey?: string;
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

type StripeListResult<T> = {
  data: T[];
  has_more?: boolean;
};

export type StripeCatalogProductObject = {
  id: string;
  name: string;
  active?: boolean;
  livemode: boolean;
  metadata?: Record<string, string | undefined>;
};

export type StripeCatalogPriceObject = {
  id: string;
  active?: boolean;
  livemode: boolean;
  product: string | StripeCatalogProductObject;
  currency: string;
  unit_amount: number | null;
  lookup_key?: string | null;
  recurring?: {
    interval?: string | null;
    interval_count?: number | null;
  } | null;
  metadata?: Record<string, string | undefined>;
};

export type StripeCatalogProvisionerClient = {
  products: {
    list(input: Record<string, unknown>): Promise<StripeListResult<StripeCatalogProductObject>>;
    create(
      input: Record<string, unknown>,
      options?: { idempotencyKey?: string },
    ): Promise<StripeCatalogProductObject>;
  };
  prices: {
    list(input: Record<string, unknown>): Promise<StripeListResult<StripeCatalogPriceObject>>;
    create(
      input: Record<string, unknown>,
      options?: { idempotencyKey?: string },
    ): Promise<StripeCatalogPriceObject>;
  };
};

export type StripeCatalogProvisionerApplyResult =
  | {
      ok: true;
      environment: "test";
      mode: "apply";
      productCount: number;
      priceCount: number;
      productsCreated: number;
      productsReconciled: number;
      pricesCreated: number;
      pricesReconciled: number;
      productNames: string[];
      states: string[];
    }
  | {
      ok: false;
      code: string;
      environment: StripeCatalogEnvironment;
      mode: ProvisionerMode;
      productName?: string;
      priceKey?: string;
    };

export type StripeCatalogProvisionerApplyInput = StripeCatalogProvisionerInput & {
  mode: "apply";
  client?: StripeCatalogProvisionerClient;
};

const PRODUCT_KEY_METADATA = "boost_ai_public_catalog_product_key";
const PRODUCT_VERSION_METADATA = "boost_ai_public_catalog_version";
const PRICE_KEY_METADATA = "boost_ai_public_catalog_price_key";
const PRICE_PRODUCT_KEY_METADATA = "boost_ai_public_catalog_product_key";
const PRICE_INTERVAL_METADATA = "boost_ai_public_catalog_interval_months";

export function assertProvisionerKeyMatchesEnvironment(input: {
  environment: StripeCatalogEnvironment;
  secretKey?: string;
  secretKeyPrefix?: string;
}) {
  const key = String(input.secretKey ?? "").trim();
  const prefix = String(input.secretKeyPrefix ?? "").trim();
  if (!key && !prefix) return { ok: true as const };
  if (key && isStripeLiveSecretKey(key)) {
    return { ok: false as const, code: "stripe_live_key_rejected" as const };
  }
  if (key && !isStripeTestSecretKey(key)) {
    return { ok: false as const, code: "stripe_test_mode_required" as const };
  }
  if (input.environment === "test" && prefix && prefix !== "sk_test" && prefix !== "rk_test") {
    return { ok: false as const, code: "test_environment_requires_test_key" as const };
  }
  if (input.environment === "live" && prefix && prefix !== "sk_live" && prefix !== "rk_live") {
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

export async function applyStripePublicCatalog(
  input: StripeCatalogProvisionerApplyInput,
): Promise<StripeCatalogProvisionerApplyResult> {
  if (input.environment !== "test") {
    return { ok: false, code: "stripe_test_environment_required", environment: input.environment, mode: input.mode };
  }
  if (!input.client) {
    return { ok: false, code: "stripe_client_required", environment: input.environment, mode: input.mode };
  }
  const secretKey = String(input.secretKey ?? "").trim();
  if (!secretKey) {
    return { ok: false, code: "stripe_test_key_required", environment: input.environment, mode: input.mode };
  }
  const keyCheck = assertProvisionerKeyMatchesEnvironment({ environment: "test", secretKey });
  if (!keyCheck.ok) {
    return { ok: false, code: keyCheck.code, environment: input.environment, mode: input.mode };
  }

  const plan = buildStripeCatalogProvisionerPlan({ environment: "test", mode: "apply" });
  if ("ok" in plan && plan.ok === false) {
    return { ok: false, code: plan.code, environment: input.environment, mode: input.mode };
  }

  const existingProducts = await listAll(input.client.products, {});
  const productByKey = new Map<string, StripeCatalogProductObject>();
  for (const product of existingProducts) {
    if (product.livemode) {
      return { ok: false, code: "stripe_live_product_rejected", environment: input.environment, mode: input.mode };
    }
    const productKey = product.metadata?.[PRODUCT_KEY_METADATA];
    if (productKey && productByKey.has(productKey)) {
      return {
        ok: false,
        code: "product_identity_duplicate",
        environment: input.environment,
        mode: input.mode,
      };
    }
    if (productKey) productByKey.set(productKey, product);
  }

  let productsCreated = 0;
  let productsReconciled = 0;
  const productObjects = new Map<string, StripeCatalogProductObject>();

  for (const productManifest of plan.products) {
    const existingByKey = productByKey.get(productManifest.productKey);
    const ambiguousByName = existingProducts.find((product) => (
      product.name === productManifest.name
      && product.metadata?.[PRODUCT_KEY_METADATA] !== productManifest.productKey
    ));
    if (ambiguousByName) {
      return {
        ok: false,
        code: "product_name_ambiguous",
        environment: input.environment,
        mode: input.mode,
        productName: productManifest.name,
      };
    }
    if (existingByKey) {
      const exact = existingByKey.name === productManifest.name
        && existingByKey.active !== false;
      if (!exact) {
        return {
          ok: false,
          code: "product_identity_conflict",
          environment: input.environment,
          mode: input.mode,
          productName: productManifest.name,
        };
      }
      productObjects.set(productManifest.productKey, existingByKey);
      productsReconciled += 1;
      continue;
    }

    const created = await input.client.products.create({
      name: productManifest.name,
      active: true,
      metadata: productMetadata(productManifest),
    }, {
      idempotencyKey: `public-catalog-product:${productManifest.productKey}`,
    });
    if (created.livemode) {
      return {
        ok: false,
        code: "stripe_live_product_rejected",
        environment: input.environment,
        mode: input.mode,
        productName: productManifest.name,
      };
    }
    productObjects.set(productManifest.productKey, created);
    productsCreated += 1;
  }

  let pricesCreated = 0;
  let pricesReconciled = 0;
  for (const priceManifest of plan.prices) {
    const product = productObjects.get(priceManifest.productKey);
    if (!product) {
      return {
        ok: false,
        code: "price_product_missing",
        environment: input.environment,
        mode: input.mode,
        priceKey: priceManifest.deterministicKey,
      };
    }

    const prices = await listAll(input.client.prices, {
      active: true,
      lookup_keys: [priceManifest.deterministicKey],
    });
    const canonicalPrices = prices.filter((price) => price.lookup_key === priceManifest.deterministicKey);
    if (canonicalPrices.length > 1) {
      return {
        ok: false,
        code: "price_identity_duplicate",
        environment: input.environment,
        mode: input.mode,
        priceKey: priceManifest.deterministicKey,
      };
    }
    const existing = canonicalPrices[0];
    if (existing) {
      const exact = priceMatchesManifest(existing, product.id, priceManifest);
      if (existing.livemode) {
        return {
          ok: false,
          code: "stripe_live_price_rejected",
          environment: input.environment,
          mode: input.mode,
          priceKey: priceManifest.deterministicKey,
        };
      }
      if (!exact) {
        return {
          ok: false,
          code: "price_identity_conflict",
          environment: input.environment,
          mode: input.mode,
          priceKey: priceManifest.deterministicKey,
        };
      }
      pricesReconciled += 1;
      continue;
    }

    const created = await input.client.prices.create({
      product: product.id,
      currency: priceManifest.currency,
      unit_amount: priceManifest.unitAmountCents,
      lookup_key: priceManifest.deterministicKey,
      recurring: {
        interval: priceManifest.recurringInterval,
        interval_count: priceManifest.recurringIntervalCount,
      },
      metadata: priceMetadata(priceManifest),
    }, {
      idempotencyKey: `public-catalog-price:${priceManifest.deterministicKey}`,
    });
    if (created.livemode) {
      return {
        ok: false,
        code: "stripe_live_price_rejected",
        environment: input.environment,
        mode: input.mode,
        priceKey: priceManifest.deterministicKey,
      };
    }
    pricesCreated += 1;
  }

  return {
    ok: true,
    environment: "test",
    mode: "apply",
    productCount: plan.products.length,
    priceCount: plan.prices.length,
    productsCreated,
    productsReconciled,
    pricesCreated,
    pricesReconciled,
    productNames: plan.products.map((product) => product.name),
    states: ["test_mode", "no_live_objects", "no_destructive_actions"],
  };
}

async function listAll<T>(
  resource: { list(input: Record<string, unknown>): Promise<StripeListResult<T>> },
  params: Record<string, unknown>,
) {
  const all: T[] = [];
  let startingAfter: string | null = null;
  do {
    const result = await resource.list(startingAfter ? { ...params, starting_after: startingAfter } : params);
    all.push(...result.data);
    const last = result.data.at(-1) as { id?: string } | undefined;
    startingAfter = result.has_more && last?.id ? last.id : null;
  } while (startingAfter);
  return all;
}

function productMetadata(product: StripePublicProductManifestEntry) {
  return {
    [PRODUCT_KEY_METADATA]: product.productKey,
    [PRODUCT_VERSION_METADATA]: product.catalogVersion,
    component_kind: product.componentKind,
    package_key: product.packageKey ?? "",
    outreach_key: product.outreachKey ?? "",
  };
}

function priceMetadata(price: StripePublicPriceManifestEntry) {
  return {
    [PRICE_KEY_METADATA]: price.deterministicKey,
    [PRICE_PRODUCT_KEY_METADATA]: price.productKey,
    [PRODUCT_VERSION_METADATA]: price.catalogVersion,
    [PRICE_INTERVAL_METADATA]: String(price.billingIntervalMonths),
    component_kind: price.componentKind,
    package_key: price.packageKey ?? "",
    outreach_key: price.outreachKey ?? "",
  };
}

function priceMatchesManifest(
  price: StripeCatalogPriceObject,
  productId: string,
  manifest: StripePublicPriceManifestEntry,
) {
  const priceProductId = typeof price.product === "string" ? price.product : price.product.id;
  return price.active !== false
    && priceProductId === productId
    && price.currency === manifest.currency
    && price.unit_amount === manifest.unitAmountCents
    && price.lookup_key === manifest.deterministicKey
    && price.recurring?.interval === manifest.recurringInterval
    && price.recurring?.interval_count === manifest.recurringIntervalCount
    && price.metadata?.[PRICE_KEY_METADATA] === manifest.deterministicKey
    && price.metadata?.[PRICE_PRODUCT_KEY_METADATA] === manifest.productKey
    && price.metadata?.[PRICE_INTERVAL_METADATA] === String(manifest.billingIntervalMonths);
}
