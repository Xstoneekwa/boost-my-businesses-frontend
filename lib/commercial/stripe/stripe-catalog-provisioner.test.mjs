import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStripePublicCatalog,
  buildStripeCatalogProvisionerPlan,
  redactProvisionerReport,
  syncStripePublicCatalogMapping,
} from "./stripe-catalog-provisioner.ts";
import { buildStripePublicPricesManifest } from "./stripe-public-catalog-manifest.ts";
import { runStripeCatalogMappingCli } from "../../../scripts/stripe-sync-public-catalog-mapping.mjs";

const EXPECTED_AMOUNTS = new Map([
  ["boost_ai_growth:1", 14700],
  ["boost_ai_growth:3", 39690],
  ["boost_ai_growth:6", 70560],
  ["boost_ai_growth:12", 132300],
  ["boost_ai_pro:1", 19700],
  ["boost_ai_pro:3", 53190],
  ["boost_ai_pro:6", 94560],
  ["boost_ai_pro:12", 177300],
  ["boost_ai_premium:1", 24700],
  ["boost_ai_premium:3", 66690],
  ["boost_ai_premium:6", 118560],
  ["boost_ai_premium:12", 222300],
  ["instagram_outreach_standard:1", 8900],
  ["instagram_outreach_standard:3", 24030],
  ["instagram_outreach_standard:6", 42720],
  ["instagram_outreach_standard:12", 80100],
  ["instagram_outreach_ai:1", 14900],
  ["instagram_outreach_ai:3", 40230],
  ["instagram_outreach_ai:6", 71520],
  ["instagram_outreach_ai:12", 134100],
]);

class FakeStripeCatalogClient {
  constructor(options = {}) {
    this.options = options;
    this.calls = [];
    this.productsData = options.products ?? [];
    this.pricesData = options.prices ?? [];
  }

  products = {
    list: async (params) => {
      this.calls.push(["products.list", params]);
      if (this.options.productListError) throw this.options.productListError;
      if (this.options.invalidProductListResponse) return this.options.invalidProductListResponse;
      return { data: this.productsData, has_more: false };
    },
    create: async (params, options) => {
      this.calls.push(["products.create", params, options]);
      const product = {
        id: `prod_${this.productsData.length + 1}`,
        name: params.name,
        active: params.active,
        livemode: Boolean(this.options.productCreateLivemode),
        metadata: params.metadata,
      };
      this.productsData.push(product);
      return product;
    },
  };

  prices = {
    list: async (params) => {
      this.calls.push(["prices.list", params]);
      if (this.options.priceListError) throw this.options.priceListError;
      const lookupKeys = new Set(params.lookup_keys ?? []);
      return {
        data: this.pricesData.filter((price) => (
          lookupKeys.has(price.lookup_key)
          && (params.active !== true || price.active !== false)
        )),
        has_more: false,
      };
    },
    create: async (params, options) => {
      this.calls.push(["prices.create", params, options]);
      const price = {
        id: `price_${this.pricesData.length + 1}`,
        active: true,
        livemode: Boolean(this.options.priceCreateLivemode),
        product: params.product,
        currency: params.currency,
        unit_amount: params.unit_amount,
        lookup_key: params.lookup_key,
        recurring: params.recurring,
        metadata: params.metadata,
      };
      this.pricesData.push(price);
      return price;
    },
  };
}

class FakeMappingStore {
  constructor(rows = []) {
    this.rows = rows;
    this.calls = [];
  }

  async listMappings(environment) {
    this.calls.push(["listMappings", environment]);
    return this.rows.filter((row) => row.environment === environment);
  }

  async upsertMappings(rows) {
    this.calls.push(["upsertMappings", rows]);
    this.rows.push(...rows);
  }
}

const FAKE_TEST_KEY = ["sk", "test", "fake", "123"].join("_");
const FAKE_LIVE_KEY = ["sk", "live", "secret", "value", "never", "reported"].join("_");
const LEAKY_SECRET = ["sk", "test", "must", "not", "leak"].join("_");
const LEAKY_URL = ["https://", "provider.example.invalid", "/secret/path"].join("");

async function applyWithFake(fake, secretKey = FAKE_TEST_KEY) {
  return applyStripePublicCatalog({
    environment: "test",
    mode: "apply",
    secretKey,
    client: fake,
  });
}

async function seededFakeCatalog() {
  const fake = new FakeStripeCatalogClient();
  const result = await applyWithFake(fake);
  assert.equal(result.ok, true);
  fake.calls = [];
  return fake;
}

async function syncWithFake(fake, store = new FakeMappingStore(), input = {}) {
  return syncStripePublicCatalogMapping({
    environment: "test",
    secretKey: input.secretKey ?? FAKE_TEST_KEY,
    client: fake,
    store,
    dryRun: input.dryRun ?? false,
  });
}

function leakyProviderError(input = {}) {
  const error = new Error(`provider message ${LEAKY_SECRET} ${LEAKY_URL}`);
  error.stack = `stack ${LEAKY_SECRET} ${LEAKY_URL}`;
  if (input.status) error.status = input.status;
  if (input.statusCode) error.statusCode = input.statusCode;
  if (input.code) error.code = input.code;
  return error;
}

function assertNoSensitiveLeak(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(LEAKY_SECRET), false);
  assert.equal(serialized.includes(LEAKY_URL), false);
  assert.equal(serialized.includes("provider message"), false);
  assert.equal(serialized.includes("stack"), false);
}

describe("stripe catalog provisioner apply", () => {
  it("keeps dry-run local and performs zero Stripe calls", () => {
    const fake = new FakeStripeCatalogClient();
    const plan = buildStripeCatalogProvisionerPlan({ environment: "test" });
    const report = redactProvisionerReport(plan);
    assert.equal(report.mode, "dry_run");
    assert.equal(report.productCount, 5);
    assert.equal(report.priceCount, 20);
    assert.equal(report.dbWritesEnabled, false);
    assert.deepEqual(fake.calls, []);
  });

  it("refuses apply without client, without key, with live key, or uncertain key", async () => {
    const withoutClient = await applyStripePublicCatalog({
      environment: "test",
      mode: "apply",
      secretKey: FAKE_TEST_KEY,
    });
    assert.equal(withoutClient.ok, false);
    assert.equal(withoutClient.code, "stripe_client_required");

    const withoutKey = await applyWithFake(new FakeStripeCatalogClient(), "");
    assert.equal(withoutKey.ok, false);
    assert.equal(withoutKey.code, "stripe_test_key_required");

    const live = await applyWithFake(new FakeStripeCatalogClient(), FAKE_LIVE_KEY);
    assert.equal(live.ok, false);
    assert.equal(live.code, "stripe_live_key_rejected");
    assert.equal(JSON.stringify(live).includes(FAKE_LIVE_KEY), false);

    const uncertain = await applyWithFake(new FakeStripeCatalogClient(), "not_a_test_key");
    assert.equal(uncertain.ok, false);
    assert.equal(uncertain.code, "stripe_test_mode_required");
  });

  it("creates exactly five canonical Products and twenty recurring public Prices in Test mode", async () => {
    const fake = new FakeStripeCatalogClient();
    const result = await applyWithFake(fake);
    assert.equal(result.ok, true);
    assert.equal(result.productsCreated, 5);
    assert.equal(result.pricesCreated, 20);
    assert.equal(result.productsReconciled, 0);
    assert.equal(result.pricesReconciled, 0);
    assert.equal(JSON.stringify(result).includes(FAKE_TEST_KEY), false);

    const productCreates = fake.calls.filter(([name]) => name === "products.create");
    const priceCreates = fake.calls.filter(([name]) => name === "prices.create");
    assert.equal(productCreates.length, 5);
    assert.equal(priceCreates.length, 20);
    assert.equal(fake.calls.every(([name]) => name === "products.list" || name === "products.create" || name === "prices.list" || name === "prices.create"), true);

    for (const [, params, options] of productCreates) {
      assert.equal(params.active, true);
      assert.match(options.idempotencyKey, /^public-catalog-product:/);
      assert.ok(params.metadata.boost_ai_public_catalog_product_key);
    }
    for (const [, params, options] of priceCreates) {
      const productKey = params.metadata.boost_ai_public_catalog_product_key;
      const interval = Number(params.metadata.boost_ai_public_catalog_interval_months);
      assert.equal(params.currency, "eur");
      assert.equal(params.recurring.interval, "month");
      assert.equal(params.recurring.interval_count, interval);
      assert.equal(params.unit_amount, EXPECTED_AMOUNTS.get(`${productKey}:${interval}`));
      assert.match(options.idempotencyKey, /^public-catalog-price:/);
    }
  });

  it("reconciles idempotently on rerun without creating duplicates", async () => {
    const fake = new FakeStripeCatalogClient();
    const first = await applyWithFake(fake);
    assert.equal(first.ok, true);
    const second = await applyWithFake(fake);
    assert.equal(second.ok, true);
    assert.equal(second.productsCreated, 0);
    assert.equal(second.pricesCreated, 0);
    assert.equal(second.productsReconciled, 5);
    assert.equal(second.pricesReconciled, 20);
    assert.equal(fake.productsData.length, 5);
    assert.equal(fake.pricesData.length, 20);
  });

  it("stops on ambiguous visible Product names before creating duplicates", async () => {
    const fake = new FakeStripeCatalogClient({
      products: [{
        id: "prod_ambiguous",
        name: "Boost AI — Growth",
        active: true,
        livemode: false,
        metadata: {},
      }],
    });
    const result = await applyWithFake(fake);
    assert.equal(result.ok, false);
    assert.equal(result.code, "product_name_ambiguous");
    assert.equal(fake.calls.some(([name]) => name === "products.create"), false);
  });

  it("stops on canonical Price economics conflicts", async () => {
    const fake = new FakeStripeCatalogClient();
    const first = await applyWithFake(fake);
    assert.equal(first.ok, true);
    fake.pricesData[0] = { ...fake.pricesData[0], unit_amount: fake.pricesData[0].unit_amount + 1 };
    const second = await applyWithFake(fake);
    assert.equal(second.ok, false);
    assert.equal(second.code, "price_identity_conflict");
  });

  it("stops on duplicate canonical Product or Price identities", async () => {
    const productSeed = {
      id: "prod_duplicate_1",
      name: "Boost AI — Growth",
      active: true,
      livemode: false,
      metadata: { boost_ai_public_catalog_product_key: "boost_ai_growth" },
    };
    const duplicateProduct = await applyWithFake(new FakeStripeCatalogClient({
      products: [productSeed, { ...productSeed, id: "prod_duplicate_2" }],
    }));
    assert.equal(duplicateProduct.ok, false);
    assert.equal(duplicateProduct.code, "product_identity_duplicate");

    const fake = new FakeStripeCatalogClient();
    const first = await applyWithFake(fake);
    assert.equal(first.ok, true);
    fake.pricesData.push({ ...fake.pricesData[0], id: "price_duplicate" });
    const duplicatePrice = await applyWithFake(fake);
    assert.equal(duplicatePrice.ok, false);
    assert.equal(duplicatePrice.code, "price_identity_duplicate");
  });

  it("stops when Stripe returns live-mode Products or Prices", async () => {
    const liveProduct = await applyWithFake(new FakeStripeCatalogClient({ productCreateLivemode: true }));
    assert.equal(liveProduct.ok, false);
    assert.equal(liveProduct.code, "stripe_live_product_rejected");

    const livePrice = await applyWithFake(new FakeStripeCatalogClient({ priceCreateLivemode: true }));
    assert.equal(livePrice.ok, false);
    assert.equal(livePrice.code, "stripe_live_price_rejected");
  });

  it("keeps agency snapshot prices out of the public catalog", () => {
    const prices = buildStripePublicPricesManifest();
    assert.equal(prices.length, 20);
    assert.equal(prices.every((price) => EXPECTED_AMOUNTS.get(`${price.productKey}:${price.billingIntervalMonths}`) === price.unitAmountCents), true);
  });
});

describe("stripe catalog mapping sync", () => {
  it("writes exactly twenty Test mappings after full Stripe validation", async () => {
    const fake = await seededFakeCatalog();
    const store = new FakeMappingStore();
    const result = await syncWithFake(fake, store);
    assert.equal(result.ok, true);
    assert.equal(result.productCount, 5);
    assert.equal(result.priceCount, 20);
    assert.equal(result.mappingsCreated, 20);
    assert.equal(result.mappingsReconciled, 0);
    assert.equal(result.livemodeFalse, true);
    assert.equal(store.rows.length, 20);
    assert.equal(store.calls.filter(([name]) => name === "upsertMappings").length, 1);
    assert.equal(fake.calls.every(([name]) => name === "products.list" || name === "prices.list"), true);
    assert.equal(store.rows.every((row) => row.environment === "test" && row.active === true && row.currency === "eur"), true);
  });

  it("reconciles mapping idempotently on rerun without duplicate writes", async () => {
    const fake = await seededFakeCatalog();
    const store = new FakeMappingStore();
    const first = await syncWithFake(fake, store);
    assert.equal(first.ok, true);
    const second = await syncWithFake(fake, store);
    assert.equal(second.ok, true);
    assert.equal(second.mappingsCreated, 0);
    assert.equal(second.mappingsReconciled, 20);
    assert.equal(store.rows.length, 20);
  });

  it("stops on incomplete Stripe catalog before any mapping write", async () => {
    const fake = await seededFakeCatalog();
    fake.pricesData.pop();
    const store = new FakeMappingStore();
    const result = await syncWithFake(fake, store);
    assert.equal(result.ok, false);
    assert.equal(result.code, "price_missing");
    assert.equal(store.calls.some(([name]) => name === "upsertMappings"), false);
  });

  it("stops on Product ambiguity, live mode, and Price economics conflicts before writes", async () => {
    const ambiguous = await syncWithFake(new FakeStripeCatalogClient({
      products: [{
        id: "prod_ambiguous",
        name: "Boost AI — Growth",
        active: true,
        livemode: false,
        metadata: {},
      }],
    }), new FakeMappingStore());
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.code, "product_name_ambiguous");

    const liveFake = await seededFakeCatalog();
    liveFake.productsData[0] = { ...liveFake.productsData[0], livemode: true };
    const liveStore = new FakeMappingStore();
    const live = await syncWithFake(liveFake, liveStore);
    assert.equal(live.ok, false);
    assert.equal(live.code, "stripe_live_product_rejected");
    assert.equal(liveStore.calls.some(([name]) => name === "upsertMappings"), false);

    const conflictFake = await seededFakeCatalog();
    conflictFake.pricesData[0] = { ...conflictFake.pricesData[0], recurring: { interval: "month", interval_count: 2 } };
    const conflictStore = new FakeMappingStore();
    const conflict = await syncWithFake(conflictFake, conflictStore);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, "price_identity_conflict");
    assert.equal(conflictStore.calls.some(([name]) => name === "upsertMappings"), false);
  });

  it("stops on divergent existing mapping without overwriting it", async () => {
    const fake = await seededFakeCatalog();
    const firstStore = new FakeMappingStore();
    const first = await syncWithFake(fake, firstStore);
    assert.equal(first.ok, true);
    const divergentRows = firstStore.rows.map((row, index) => (
      index === 0 ? { ...row, stripe_price_id: "price_divergent" } : row
    ));
    const store = new FakeMappingStore(divergentRows);
    const result = await syncWithFake(fake, store);
    assert.equal(result.ok, false);
    assert.equal(result.code, "mapping_identity_conflict");
    assert.equal(store.calls.some(([name]) => name === "upsertMappings"), false);
  });

  it("supports dry-run mapping validation without a mapping store or writes", async () => {
    const fake = await seededFakeCatalog();
    const result = await syncWithFake(fake, undefined, { dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.mappingsCreated, 20);
    assert.equal(result.mappingsReconciled, 0);
  });

  it("returns safe diagnostics for Stripe 403 without leaking provider details", async () => {
    const result = await syncWithFake(new FakeStripeCatalogClient({
      productListError: leakyProviderError({ status: 403, code: "permission_denied" }),
    }), undefined, { dryRun: true });
    assert.equal(result.ok, false);
    assert.equal(result.code, "stripe_catalog_read_forbidden");
    assert.equal(result.stage, "stripe_catalog_read");
    assert.equal(result.provider_status, 403);
    assert.equal(result.provider_code, "permission_denied");
    assertNoSensitiveLeak(result);
  });

  it("returns safe diagnostics for generic Stripe read failures", async () => {
    const result = await syncWithFake(new FakeStripeCatalogClient({
      productListError: leakyProviderError(),
    }), undefined, { dryRun: true });
    assert.equal(result.ok, false);
    assert.equal(result.code, "stripe_catalog_read_failed");
    assert.equal(result.stage, "stripe_catalog_read");
    assert.equal(result.provider_status, undefined);
    assert.equal(result.provider_code, undefined);
    assertNoSensitiveLeak(result);
  });

  it("returns safe diagnostics for Supabase mapping read and write failures", async () => {
    const fakeForRead = await seededFakeCatalog();
    const readStore = {
      listMappings: async () => {
        throw leakyProviderError({ status: 403, code: "42501" });
      },
      upsertMappings: async () => assert.fail("write must not run after read failure"),
    };
    const readResult = await syncWithFake(fakeForRead, readStore);
    assert.equal(readResult.ok, false);
    assert.equal(readResult.code, "production_mapping_schema_or_rls_failed");
    assert.equal(readResult.stage, "mapping_read");
    assert.equal(readResult.provider_status, 403);
    assert.equal(readResult.provider_code, "42501");
    assertNoSensitiveLeak(readResult);

    const fakeForWrite = await seededFakeCatalog();
    const writeStore = {
      listMappings: async () => [],
      upsertMappings: async () => {
        throw leakyProviderError({ status: 500 });
      },
    };
    const writeResult = await syncWithFake(fakeForWrite, writeStore);
    assert.equal(writeResult.ok, false);
    assert.equal(writeResult.code, "production_mapping_write_failed");
    assert.equal(writeResult.stage, "mapping_write");
    assert.equal(writeResult.provider_status, 500);
    assert.equal(writeResult.provider_code, undefined);
    assertNoSensitiveLeak(writeResult);
  });

  it("returns safe diagnostics for unexpected sync failures", async () => {
    const fake = await seededFakeCatalog();
    const store = {
      listMappings: async () => null,
      upsertMappings: async () => assert.fail("write must not run after unexpected failure"),
    };
    const result = await syncWithFake(fake, store);
    assert.equal(result.ok, false);
    assert.equal(result.code, "unexpected_sync_failure");
    assert.equal(result.stage, "validation");
    assertNoSensitiveLeak(result);
  });

  it("CLI stderr exposes only allowlisted diagnostics on unexpected failures", async () => {
    const stdout = [];
    const stderr = [];
    const exitCode = await runStripeCatalogMappingCli({
      argv: [],
      env: {
        STRIPE_SECRET_KEY: FAKE_TEST_KEY,
        SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "local-service-role-placeholder",
      },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      createStripeClient: () => ({}),
      createSupabaseClient: () => ({}),
      syncStripePublicCatalogMapping: async () => {
        throw leakyProviderError();
      },
    });
    assert.equal(exitCode, 2);
    assert.deepEqual(stdout, []);
    assert.equal(stderr.length, 1);
    assert.deepEqual(JSON.parse(stderr[0]), {
      ok: false,
      code: "unexpected_sync_failure",
      stage: "validation",
    });
    assertNoSensitiveLeak(stderr);
  });
});
