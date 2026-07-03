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

export type SafeCatalogMappingStage =
  | "stripe_catalog_read"
  | "mapping_read"
  | "mapping_write"
  | "validation";

export type SafeCatalogMappingFailurePayload = {
  ok: false;
  code: string;
  stage: SafeCatalogMappingStage;
  provider_status?: number;
  provider_code?: string;
};

export class SafeCatalogMappingError extends Error {
  code: string;
  stage: SafeCatalogMappingStage;
  provider_status?: number;
  provider_code?: string;

  constructor(input: {
    code: string;
    stage: SafeCatalogMappingStage;
    provider_status?: number;
    provider_code?: string;
  }) {
    super(input.code);
    this.name = "SafeCatalogMappingError";
    this.code = input.code;
    this.stage = input.stage;
    this.provider_status = input.provider_status;
    this.provider_code = input.provider_code;
  }
}

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

export type StripeComponentPriceCatalogMappingRow = {
  environment: StripeCatalogEnvironment;
  product_key: string;
  component_kind: string;
  package_key: string | null;
  outreach_key: string | null;
  billing_interval_months: number;
  stripe_product_id: string;
  stripe_price_id: string;
  expected_amount_cents: number;
  currency: "eur";
  active: boolean;
  catalog_version: string;
  fingerprint: string;
  metadata_safe: Record<string, string | number | boolean | null>;
};

export type StripeCatalogMappingStore = {
  listMappings(environment: StripeCatalogEnvironment): Promise<StripeComponentPriceCatalogMappingRow[]>;
  upsertMappings(rows: StripeComponentPriceCatalogMappingRow[]): Promise<void>;
};

export type StripeCatalogMappingSyncResult =
  | {
      ok: true;
      environment: "test";
      mode: "sync_mapping";
      productCount: number;
      priceCount: number;
      mappingsCreated: number;
      mappingsReconciled: number;
      livemodeFalse: true;
      productNames: string[];
      states: string[];
    }
  | {
      ok: false;
      code: string;
      environment: StripeCatalogEnvironment;
      mode: "sync_mapping";
      stage?: SafeCatalogMappingStage;
      provider_status?: number;
      provider_code?: string;
      productName?: string;
      priceKey?: string;
    };

export type StripeCatalogMappingSyncInput = {
  environment: StripeCatalogEnvironment;
  secretKey?: string;
  client?: Pick<StripeCatalogProvisionerClient, "products" | "prices">;
  store?: StripeCatalogMappingStore;
  dryRun?: boolean;
};

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

export async function syncStripePublicCatalogMapping(
  input: StripeCatalogMappingSyncInput,
): Promise<StripeCatalogMappingSyncResult> {
  try {
    return await syncStripePublicCatalogMappingInner(input);
  } catch (error) {
    return mappingSyncFailure(input.environment, safeCatalogMappingFailurePayload(error, {
      code: "unexpected_sync_failure",
      stage: "validation",
    }));
  }
}

async function syncStripePublicCatalogMappingInner(
  input: StripeCatalogMappingSyncInput,
): Promise<StripeCatalogMappingSyncResult> {
  if (input.environment !== "test") {
    return { ok: false, code: "stripe_test_environment_required", environment: input.environment, mode: "sync_mapping", stage: "validation" };
  }
  if (!input.client) {
    return { ok: false, code: "stripe_client_required", environment: input.environment, mode: "sync_mapping", stage: "validation" };
  }
  const secretKey = String(input.secretKey ?? "").trim();
  if (!secretKey) {
    return { ok: false, code: "stripe_test_key_required", environment: input.environment, mode: "sync_mapping", stage: "validation" };
  }
  const keyCheck = assertProvisionerKeyMatchesEnvironment({ environment: "test", secretKey });
  if (!keyCheck.ok) {
    return { ok: false, code: keyCheck.code, environment: input.environment, mode: "sync_mapping", stage: "validation" };
  }
  if (!input.dryRun && !input.store) {
    return { ok: false, code: "mapping_store_required", environment: input.environment, mode: "sync_mapping", stage: "validation" };
  }

  const plan = buildStripeCatalogProvisionerPlan({ environment: "test", mode: "dry_run" });
  if ("ok" in plan && plan.ok === false) {
    return { ok: false, code: plan.code, environment: input.environment, mode: "sync_mapping", stage: "validation" };
  }

  const productResult = await loadCanonicalStripeProducts(input.client, plan.products);
  if (!productResult.ok) {
    return { ...productResult, environment: input.environment, mode: "sync_mapping" };
  }
  const priceResult = await loadCanonicalStripePrices(input.client, productResult.productsByKey, plan.prices);
  if (!priceResult.ok) {
    return { ...priceResult, environment: input.environment, mode: "sync_mapping" };
  }

  const desiredRows = plan.prices.map((price) => (
    mappingRowFromManifest(price, productResult.productsByKey.get(price.productKey)!, priceResult.pricesByKey.get(price.deterministicKey)!)
  ));

  let mappingsCreated = desiredRows.length;
  let mappingsReconciled = 0;
  if (!input.dryRun) {
    let existingRows: StripeComponentPriceCatalogMappingRow[];
    try {
      existingRows = await input.store!.listMappings("test");
    } catch (error) {
      throw safeProviderError(error, {
        code: "production_mapping_read_failed",
        stage: "mapping_read",
        schemaOrRlsCode: "production_mapping_schema_or_rls_failed",
      });
    }
    const reconcileResult = reconcileMappingRows(existingRows, desiredRows);
    if (!reconcileResult.ok) {
      return { ...reconcileResult, environment: input.environment, mode: "sync_mapping" };
    }
    mappingsCreated = reconcileResult.rowsToCreate.length;
    mappingsReconciled = reconcileResult.mappingsReconciled;
    if (reconcileResult.rowsToCreate.length > 0) {
      try {
        await input.store!.upsertMappings(reconcileResult.rowsToCreate);
      } catch (error) {
        throw safeProviderError(error, {
          code: "production_mapping_write_failed",
          stage: "mapping_write",
        });
      }
    }
  }

  return {
    ok: true,
    environment: "test",
    mode: "sync_mapping",
    productCount: plan.products.length,
    priceCount: plan.prices.length,
    mappingsCreated,
    mappingsReconciled,
    livemodeFalse: true,
    productNames: plan.products.map((product) => product.name),
    states: ["test_mode", "stripe_read_only", "mapping_validated_before_write", "agency_prices_excluded"],
  };
}

export function safeCatalogMappingFailurePayload(
  error: unknown,
  fallback: {
    code: string;
    stage: SafeCatalogMappingStage;
  },
): SafeCatalogMappingFailurePayload {
  if (error instanceof SafeCatalogMappingError) {
    return compactFailurePayload({
      ok: false,
      code: error.code,
      stage: error.stage,
      provider_status: error.provider_status,
      provider_code: error.provider_code,
    });
  }
  return compactFailurePayload({
    ok: false,
    code: fallback.code,
    stage: fallback.stage,
    provider_status: safeProviderStatus(error),
    provider_code: safeProviderCode(error),
  });
}

async function listAll<T>(
  resource: { list(input: Record<string, unknown>): Promise<StripeListResult<T>> },
  params: Record<string, unknown>,
  diagnostics?: { stage: "stripe_catalog_read" },
) {
  const all: T[] = [];
  let startingAfter: string | null = null;
  do {
    let result: StripeListResult<T>;
    try {
      result = await resource.list(startingAfter ? { ...params, starting_after: startingAfter } : params);
    } catch (error) {
      if (diagnostics) throw safeProviderError(error, {
        code: "stripe_catalog_read_failed",
        stage: diagnostics.stage,
        forbiddenCode: "stripe_catalog_read_forbidden",
      });
      throw error;
    }
    if (!result || !Array.isArray(result.data) || (
      result.has_more !== undefined
      && typeof result.has_more !== "boolean"
    )) {
      if (diagnostics) {
        throw new SafeCatalogMappingError({
          code: "stripe_catalog_invalid_response",
          stage: diagnostics.stage,
        });
      }
    }
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

async function loadCanonicalStripeProducts(
  client: Pick<StripeCatalogProvisionerClient, "products">,
  products: StripePublicProductManifestEntry[],
): Promise<
  | { ok: true; productsByKey: Map<string, StripeCatalogProductObject> }
  | { ok: false; code: string; productName?: string }
> {
  const allProducts = await listAll(client.products, {}, { stage: "stripe_catalog_read" });
  const productsByKey = new Map<string, StripeCatalogProductObject>();
  for (const product of allProducts) {
    if (product.livemode) return { ok: false, code: "stripe_live_product_rejected" };
    const productKey = product.metadata?.[PRODUCT_KEY_METADATA];
    if (productKey && productsByKey.has(productKey)) return { ok: false, code: "product_identity_duplicate" };
    if (productKey) productsByKey.set(productKey, product);
  }

  for (const productManifest of products) {
    const ambiguousByName = allProducts.find((product) => (
      product.name === productManifest.name
      && product.metadata?.[PRODUCT_KEY_METADATA] !== productManifest.productKey
    ));
    if (ambiguousByName) {
      return { ok: false, code: "product_name_ambiguous", productName: productManifest.name };
    }
    const product = productsByKey.get(productManifest.productKey);
    if (!product) return { ok: false, code: "product_missing", productName: productManifest.name };
    if (product.name !== productManifest.name || product.active === false) {
      return { ok: false, code: "product_identity_conflict", productName: productManifest.name };
    }
  }
  return { ok: true, productsByKey };
}

async function loadCanonicalStripePrices(
  client: Pick<StripeCatalogProvisionerClient, "prices">,
  productsByKey: Map<string, StripeCatalogProductObject>,
  prices: StripePublicPriceManifestEntry[],
): Promise<
  | { ok: true; pricesByKey: Map<string, StripeCatalogPriceObject> }
  | { ok: false; code: string; priceKey?: string }
> {
  const pricesByKey = new Map<string, StripeCatalogPriceObject>();
  for (const priceManifest of prices) {
    const product = productsByKey.get(priceManifest.productKey);
    if (!product) return { ok: false, code: "price_product_missing", priceKey: priceManifest.deterministicKey };
    const matches = await listAll(client.prices, { lookup_keys: [priceManifest.deterministicKey] }, { stage: "stripe_catalog_read" });
    const canonicalPrices = matches.filter((price) => price.lookup_key === priceManifest.deterministicKey);
    if (canonicalPrices.length === 0) return { ok: false, code: "price_missing", priceKey: priceManifest.deterministicKey };
    if (canonicalPrices.length > 1) return { ok: false, code: "price_identity_duplicate", priceKey: priceManifest.deterministicKey };
    const price = canonicalPrices[0];
    if (price.livemode) return { ok: false, code: "stripe_live_price_rejected", priceKey: priceManifest.deterministicKey };
    if (!priceMatchesManifest(price, product.id, priceManifest)) {
      return { ok: false, code: "price_identity_conflict", priceKey: priceManifest.deterministicKey };
    }
    pricesByKey.set(priceManifest.deterministicKey, price);
  }
  return { ok: true, pricesByKey };
}

function mappingRowFromManifest(
  manifest: StripePublicPriceManifestEntry,
  product: StripeCatalogProductObject,
  price: StripeCatalogPriceObject,
): StripeComponentPriceCatalogMappingRow {
  return {
    environment: "test",
    product_key: manifest.productKey,
    component_kind: manifest.componentKind,
    package_key: manifest.packageKey,
    outreach_key: manifest.outreachKey,
    billing_interval_months: manifest.billingIntervalMonths,
    stripe_product_id: product.id,
    stripe_price_id: price.id,
    expected_amount_cents: manifest.unitAmountCents,
    currency: manifest.currency,
    active: true,
    catalog_version: manifest.catalogVersion,
    fingerprint: manifest.deterministicKey,
    metadata_safe: {
      source: "stripe_test_public_catalog_mapping_sync",
      stripe_lookup_key: manifest.deterministicKey,
      product_key: manifest.productKey,
      component_kind: manifest.componentKind,
      billing_interval_months: manifest.billingIntervalMonths,
      livemode: false,
    },
  };
}

function reconcileMappingRows(
  existingRows: StripeComponentPriceCatalogMappingRow[],
  desiredRows: StripeComponentPriceCatalogMappingRow[],
):
  | { ok: true; rowsToCreate: StripeComponentPriceCatalogMappingRow[]; mappingsReconciled: number }
  | { ok: false; code: string; priceKey?: string } {
  const existingByKey = new Map<string, StripeComponentPriceCatalogMappingRow>();
  for (const row of existingRows.filter((row) => row.environment === "test" && row.active !== false)) {
    const key = mappingIdentity(row);
    if (existingByKey.has(key)) return { ok: false, code: "mapping_identity_duplicate", priceKey: row.fingerprint };
    existingByKey.set(key, row);
  }

  const rowsToCreate: StripeComponentPriceCatalogMappingRow[] = [];
  let mappingsReconciled = 0;
  for (const desired of desiredRows) {
    const existing = existingByKey.get(mappingIdentity(desired));
    if (!existing) {
      rowsToCreate.push(desired);
      continue;
    }
    if (!mappingRowsMatch(existing, desired)) {
      return { ok: false, code: "mapping_identity_conflict", priceKey: desired.fingerprint };
    }
    mappingsReconciled += 1;
  }
  return { ok: true, rowsToCreate, mappingsReconciled };
}

function mappingIdentity(row: StripeComponentPriceCatalogMappingRow) {
  return [
    row.environment,
    row.product_key,
    row.component_kind,
    row.billing_interval_months,
    row.expected_amount_cents,
    row.currency,
  ].join(":");
}

function mappingRowsMatch(
  existing: StripeComponentPriceCatalogMappingRow,
  desired: StripeComponentPriceCatalogMappingRow,
) {
  return existing.environment === desired.environment
    && existing.product_key === desired.product_key
    && existing.component_kind === desired.component_kind
    && (existing.package_key ?? null) === desired.package_key
    && (existing.outreach_key ?? null) === desired.outreach_key
    && Number(existing.billing_interval_months) === desired.billing_interval_months
    && existing.stripe_product_id === desired.stripe_product_id
    && existing.stripe_price_id === desired.stripe_price_id
    && Number(existing.expected_amount_cents) === desired.expected_amount_cents
    && existing.currency === desired.currency
    && existing.active === true
    && existing.catalog_version === desired.catalog_version
    && existing.fingerprint === desired.fingerprint;
}

function mappingSyncFailure(
  environment: StripeCatalogEnvironment,
  failure: SafeCatalogMappingFailurePayload,
) {
  return {
    ...failure,
    environment,
    mode: "sync_mapping" as const,
  };
}

function safeProviderError(
  error: unknown,
  input: {
    code: string;
    stage: SafeCatalogMappingStage;
    forbiddenCode?: string;
    schemaOrRlsCode?: string;
  },
) {
  const provider_status = safeProviderStatus(error);
  const provider_code = safeProviderCode(error);
  let code = input.code;
  if ((provider_status === 401 || provider_status === 403) && input.forbiddenCode) {
    code = input.forbiddenCode;
  }
  if (
    input.schemaOrRlsCode
    && (
      provider_status === 401
      || provider_status === 403
      || provider_code === "42501"
      || provider_code === "42P01"
      || provider_code === "42703"
      || provider_code === "PGRST200"
      || provider_code === "PGRST204"
    )
  ) {
    code = input.schemaOrRlsCode;
  }
  return new SafeCatalogMappingError({
    code,
    stage: input.stage,
    provider_status,
    provider_code,
  });
}

function safeProviderStatus(error: unknown) {
  const record = errorRecord(error);
  const raw = errorRecord(record.raw);
  const response = errorRecord(record.response);
  for (const value of [record.status, record.statusCode, raw.status, raw.statusCode, response.status]) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) {
      return value;
    }
  }
  return undefined;
}

function safeProviderCode(error: unknown) {
  const record = errorRecord(error);
  const raw = errorRecord(record.raw);
  const response = errorRecord(record.response);
  const body = errorRecord(response.body);
  for (const value of [record.code, raw.code, body.code]) {
    if (typeof value === "string" && ALLOWED_PROVIDER_CODES.has(value)) {
      return value;
    }
  }
  return undefined;
}

function errorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function compactFailurePayload(payload: SafeCatalogMappingFailurePayload): SafeCatalogMappingFailurePayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ) as SafeCatalogMappingFailurePayload;
}

const ALLOWED_PROVIDER_CODES = new Set([
  "permission_denied",
  "authentication_error",
  "api_connection_error",
  "rate_limit_error",
  "invalid_request_error",
  "resource_missing",
  "42501",
  "42P01",
  "42703",
  "PGRST200",
  "PGRST204",
]);
