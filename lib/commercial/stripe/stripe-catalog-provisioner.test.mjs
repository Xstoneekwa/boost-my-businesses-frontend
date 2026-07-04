import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  applyStripePublicCatalog,
  buildStripeCatalogProvisionerPlan,
  redactProvisionerReport,
  SafeCatalogMappingError,
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
    buildPlanForTests: input.buildPlanForTests,
  });
}

async function runCliWithFake(input = {}) {
  const stdout = [];
  const stderr = [];
  const fake = input.fake ?? await seededFakeCatalog();
  const store = input.store ?? new FakeMappingStore();
  const exitCode = await runStripeCatalogMappingCli({
    argv: input.argv ?? [],
    env: input.env ?? {
      STRIPE_SECRET_KEY: FAKE_TEST_KEY,
      SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "local-service-role-placeholder",
    },
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    createStripeClient: input.createStripeClient ?? (() => fake),
    createSupabaseClient: input.createSupabaseClient ?? (() => ({})),
    createMappingStore: input.createMappingStore ?? (() => store),
    buildPlanForTests: input.buildPlanForTests,
    syncStripePublicCatalogMapping: input.syncStripePublicCatalogMapping,
    now: input.now,
  });
  return {
    exitCode,
    stdout,
    stderr,
    output: stdout[0] ? JSON.parse(stdout[0]) : null,
    failure: stderr[0] ? JSON.parse(stderr[0]) : null,
    fake,
    store,
  };
}

async function withDiagnosticFile(run) {
  const dir = await mkdtemp(join(tmpdir(), "stripe-mapping-diagnostic-test-"));
  const diagnosticPath = join(dir, "diagnostic.json");
  try {
    return await run(diagnosticPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function leakyProviderError(input = {}) {
  const error = new Error(`provider message ${LEAKY_SECRET} ${LEAKY_URL}`);
  error.stack = `stack ${LEAKY_SECRET} ${LEAKY_URL}`;
  if (input.status) error.status = input.status;
  if (input.statusCode) error.statusCode = input.statusCode;
  if (input.code) error.code = input.code;
  return error;
}

function leakyRuntimeError() {
  const error = new TypeError(`runtime message ${LEAKY_SECRET} ${LEAKY_URL}`);
  error.stack = `runtime stack ${LEAKY_SECRET} ${LEAKY_URL}`;
  return error;
}

function assertNoSensitiveLeak(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(LEAKY_SECRET), false);
  assert.equal(serialized.includes(LEAKY_URL), false);
  assert.equal(serialized.includes("provider message"), false);
  assert.equal(serialized.includes("runtime message"), false);
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
    assert.equal(result.code, "production_mapping_validation_failed");
    assert.equal(result.stage, "validation");
    assert.equal(result.checkpoint, "mapping_store_read");
    assertNoSensitiveLeak(result);
  });

  it("classifies standard manifest validation throws without leaking raw details", async () => {
    const fake = new FakeStripeCatalogClient();
    const result = await syncWithFake(fake, undefined, {
      dryRun: true,
      buildPlanForTests: () => {
        throw leakyProviderError();
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "stripe_catalog_manifest_invalid");
    assert.equal(result.stage, "validation");
    assert.deepEqual(fake.calls, []);
    assertNoSensitiveLeak(result);
  });

  it("preserves allowlisted SafeCatalogMappingError validation codes", async () => {
    const fake = new FakeStripeCatalogClient();
    const result = await syncWithFake(fake, undefined, {
      dryRun: true,
      buildPlanForTests: () => {
        throw new SafeCatalogMappingError({
          code: "stripe_catalog_validation_failed",
          stage: "validation",
        });
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "stripe_catalog_validation_failed");
    assert.equal(result.stage, "validation");
    assert.deepEqual(fake.calls, []);
    assertNoSensitiveLeak(result);
  });

  it("recognizes safe validation errors without relying on instanceof", async () => {
    const fake = new FakeStripeCatalogClient();
    const foreignSafeError = Object.assign(new Error(`foreign safe ${LEAKY_SECRET} ${LEAKY_URL}`), {
      code: "production_mapping_validation_failed",
      stage: "validation",
    });
    const result = await syncWithFake(fake, undefined, {
      dryRun: true,
      buildPlanForTests: () => {
        throw foreignSafeError;
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "production_mapping_validation_failed");
    assert.equal(result.stage, "validation");
    assert.deepEqual(fake.calls, []);
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
      checkpoint: "mapping_store_init",
    });
    assertNoSensitiveLeak(stderr);
  });

  it("CLI surfaces Stripe client runtime failures before sync starts", async () => {
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
      createStripeClient: () => {
        throw leakyRuntimeError();
      },
      createSupabaseClient: () => ({}),
      syncStripePublicCatalogMapping: async () => assert.fail("sync must not start after client validation failure"),
    });
    assert.equal(exitCode, 2);
    assert.deepEqual(stdout, []);
    assert.equal(stderr.length, 1);
    assert.deepEqual(JSON.parse(stderr[0]), {
      ok: false,
      code: "unexpected_sync_failure",
      stage: "validation",
      checkpoint: "stripe_client_init",
    });
    assertNoSensitiveLeak(stderr);
  });

  it("CLI preserves known Stripe client validation failures before sync starts", async () => {
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
      createStripeClient: () => {
        throw leakyProviderError();
      },
      createSupabaseClient: () => ({}),
      syncStripePublicCatalogMapping: async () => assert.fail("sync must not start after client validation failure"),
    });
    assert.equal(exitCode, 2);
    assert.deepEqual(stdout, []);
    assert.equal(stderr.length, 1);
    assert.deepEqual(JSON.parse(stderr[0]), {
      ok: false,
      code: "stripe_catalog_validation_failed",
      stage: "validation",
      checkpoint: "stripe_client_init",
    });
    assertNoSensitiveLeak(stderr);
  });
});

describe("stripe catalog mapping CLI real injected path", () => {
  it("classifies manifest validation failures from the CLI path", async () => {
    const result = await runCliWithFake({
      fake: new FakeStripeCatalogClient(),
      buildPlanForTests: () => {
        throw leakyProviderError();
      },
    });
    assert.equal(result.exitCode, 2);
    assert.deepEqual(result.stdout, []);
    assert.deepEqual(result.failure, {
      ok: false,
      code: "stripe_catalog_manifest_invalid",
      stage: "validation",
      checkpoint: "manifest_match",
    });
    assertNoSensitiveLeak(result.stderr);
  });

  it("classifies ambiguous Products from the CLI path", async () => {
    const result = await runCliWithFake({
      fake: new FakeStripeCatalogClient({
        products: [{
          id: "prod_ambiguous",
          name: "Boost AI — Growth",
          active: true,
          livemode: false,
          metadata: {},
        }],
      }),
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.failure.code, "product_name_ambiguous");
    assert.equal(result.failure.stage, "validation");
    assert.equal(result.failure.checkpoint, "manifest_match");
    assertNoSensitiveLeak(result.stderr);
  });

  it("classifies incoherent Price attributes without throwing TypeError", async () => {
    const fake = await seededFakeCatalog();
    fake.pricesData[0] = { ...fake.pricesData[0], product: undefined };
    const result = await runCliWithFake({ fake });
    assert.equal(result.exitCode, 2);
    assert.equal(result.failure.code, "price_identity_conflict");
    assert.equal(result.failure.stage, "validation");
    assert.equal(result.failure.checkpoint, "price_attributes");
    assertNoSensitiveLeak(result.stderr);
  });

  it("classifies incomplete Stripe catalog results from the CLI path", async () => {
    const fake = await seededFakeCatalog();
    fake.pricesData.pop();
    const result = await runCliWithFake({ fake });
    assert.equal(result.exitCode, 2);
    assert.equal(result.failure.code, "price_missing");
    assert.equal(result.failure.stage, "validation");
    assert.equal(result.failure.checkpoint, "stripe_prices_read");
    assertNoSensitiveLeak(result.stderr);
  });

  it("classifies mapping store read failures from the CLI path", async () => {
    const store = {
      listMappings: async () => {
        throw leakyProviderError({ status: 403, code: "42501" });
      },
      upsertMappings: async () => assert.fail("write must not run after read failure"),
    };
    const result = await runCliWithFake({
      store,
      argv: ["--apply", "--i-understand-this-writes-production-mapping"],
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.failure.code, "production_mapping_schema_or_rls_failed");
    assert.equal(result.failure.stage, "mapping_read");
    assert.equal(result.failure.checkpoint, "mapping_store_read");
    assert.equal(result.failure.provider_status, 403);
    assert.equal(result.failure.provider_code, "42501");
    assertNoSensitiveLeak(result.stderr);
  });

  it("classifies mapping conflicts from the CLI path without overwriting", async () => {
    const fake = await seededFakeCatalog();
    const store = new FakeMappingStore();
    const applyArgv = ["--apply", "--i-understand-this-writes-production-mapping"];
    const first = await runCliWithFake({ fake, store, argv: applyArgv });
    assert.equal(first.exitCode, 0);
    assert.equal(store.rows.length, 20);
    store.rows[0] = { ...store.rows[0], stripe_price_id: "price_divergent" };

    const second = await runCliWithFake({ fake, store, argv: applyArgv });
    assert.equal(second.exitCode, 2);
    assert.equal(second.failure.code, "mapping_identity_conflict");
    assert.equal(second.failure.stage, "validation");
    assert.equal(second.failure.checkpoint, "mapping_conflict_check");
    assert.equal(store.calls.filter(([name]) => name === "upsertMappings").length, 1);
    assertNoSensitiveLeak(second.stderr);
  });

  it("classifies mapping store write failures from the CLI path", async () => {
    const store = {
      listMappings: async () => [],
      upsertMappings: async () => {
        throw leakyProviderError({ status: 500 });
      },
    };
    const result = await runCliWithFake({
      store,
      argv: ["--apply", "--i-understand-this-writes-production-mapping"],
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.failure.code, "production_mapping_write_failed");
    assert.equal(result.failure.stage, "mapping_write");
    assert.equal(result.failure.checkpoint, "mapping_store_write");
    assert.equal(result.failure.provider_status, 500);
    assertNoSensitiveLeak(result.stderr);
  });

  it("keeps only true unknown TypeErrors as unexpected failures", async () => {
    const result = await runCliWithFake({
      fake: new FakeStripeCatalogClient({ products: [null] }),
    });
    assert.equal(result.exitCode, 2);
    assert.deepEqual(result.failure, {
      ok: false,
      code: "unexpected_sync_failure",
      stage: "validation",
      checkpoint: "stripe_products_read",
    });
    assertNoSensitiveLeak(result.stderr);
  });

  it("keeps dry-run without mapping writes and apply protected", async () => {
    const dryRun = await runCliWithFake({
      store: {
        listMappings: async () => assert.fail("dry-run must not read mappings"),
        upsertMappings: async () => assert.fail("dry-run must not write mappings"),
      },
    });
    assert.equal(dryRun.exitCode, 0);
    assert.equal(dryRun.output.ok, true);
    assert.equal(dryRun.output.mode, "dry_run");
    assert.equal(dryRun.output.mappingsCreated, 20);

    const protectedApply = await runStripeCatalogMappingCli({
      argv: ["--apply"],
      env: {},
      stdout: () => assert.fail("protected apply must not write stdout"),
      stderr: (line) => dryRun.stderr.push(line),
      createStripeClient: () => assert.fail("protected apply must not create Stripe client"),
      createSupabaseClient: () => assert.fail("protected apply must not create Supabase client"),
      createMappingStore: () => assert.fail("protected apply must not create mapping store"),
    });
    assert.equal(protectedApply, 2);
    assert.deepEqual(JSON.parse(dryRun.stderr.at(-1)), {
      ok: false,
      code: "mapping_apply_confirmation_required",
      stage: "validation",
      checkpoint: "cli_preflight",
    });
  });
});

describe("stripe catalog mapping CLI unexpected runtime checkpoints", () => {
  async function assertUnexpectedCheckpoint(input, checkpoint) {
    const result = await runCliWithFake(input);
    assert.equal(result.exitCode, 2);
    assert.deepEqual(result.stdout, []);
    assert.deepEqual(result.failure, {
      ok: false,
      code: "unexpected_sync_failure",
      stage: "validation",
      checkpoint,
    });
    assertNoSensitiveLeak(result.stderr);
    return result;
  }

  it("surfaces stripe_client_init for unknown Stripe client initialization failures", async () => {
    await assertUnexpectedCheckpoint({
      createStripeClient: () => {
        throw leakyRuntimeError();
      },
    }, "stripe_client_init");
  });

  it("surfaces stripe_products_read for unknown Product read failures", async () => {
    await assertUnexpectedCheckpoint({
      fake: new FakeStripeCatalogClient({
        productListError: leakyRuntimeError(),
      }),
    }, "stripe_products_read");
  });

  it("surfaces stripe_prices_read for unknown Price read failures", async () => {
    const fake = await seededFakeCatalog();
    fake.options.priceListError = leakyRuntimeError();
    await assertUnexpectedCheckpoint({ fake }, "stripe_prices_read");
  });

  it("surfaces manifest_match for unknown manifest validation failures", async () => {
    await assertUnexpectedCheckpoint({
      fake: new FakeStripeCatalogClient(),
      buildPlanForTests: () => {
        throw leakyRuntimeError();
      },
    }, "manifest_match");
  });

  it("surfaces price_attributes for unknown Price attribute validation failures", async () => {
    const fake = await seededFakeCatalog();
    Object.defineProperty(fake.pricesData[0], "recurring", {
      get() {
        throw leakyRuntimeError();
      },
    });
    await assertUnexpectedCheckpoint({ fake }, "price_attributes");
  });

  it("surfaces mapping_store_init for unknown mapping store construction failures", async () => {
    await assertUnexpectedCheckpoint({
      createMappingStore: () => {
        throw leakyRuntimeError();
      },
    }, "mapping_store_init");
  });

  it("surfaces mapping_store_read for unknown mapping read failures", async () => {
    await assertUnexpectedCheckpoint({
      argv: ["--apply", "--i-understand-this-writes-production-mapping"],
      store: {
        listMappings: async () => {
          throw leakyRuntimeError();
        },
        upsertMappings: async () => assert.fail("write must not run after read failure"),
      },
    }, "mapping_store_read");
  });

  it("surfaces mapping_conflict_check for unknown mapping reconciliation failures", async () => {
    await assertUnexpectedCheckpoint({
      argv: ["--apply", "--i-understand-this-writes-production-mapping"],
      store: {
        listMappings: async () => [null],
        upsertMappings: async () => assert.fail("write must not run after conflict failure"),
      },
    }, "mapping_conflict_check");
  });

  it("surfaces mapping_store_write for unknown mapping write failures", async () => {
    await assertUnexpectedCheckpoint({
      argv: ["--apply", "--i-understand-this-writes-production-mapping"],
      store: {
        listMappings: async () => [],
        upsertMappings: async () => {
          throw leakyRuntimeError();
        },
      },
    }, "mapping_store_write");
  });
});

describe("stripe mapping safe diagnostics workflow", () => {
  it("writes redacted diagnostic files for known failures only when explicitly requested", async () => {
    await withDiagnosticFile(async (diagnosticPath) => {
      const result = await runCliWithFake({
        fake: new FakeStripeCatalogClient({
          productListError: leakyProviderError({ status: 403, code: "permission_denied" }),
        }),
        env: {
          STRIPE_SECRET_KEY: FAKE_TEST_KEY,
          SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "local-service-role-placeholder",
          STRIPE_MAPPING_DIAGNOSTIC_FILE: diagnosticPath,
        },
        now: () => new Date("2026-07-04T00:00:00.000Z"),
      });
      assert.equal(result.exitCode, 2);
      const diagnostic = JSON.parse(await readFile(diagnosticPath, "utf8"));
      assert.deepEqual(diagnostic, {
        ok: false,
        code: "stripe_catalog_read_forbidden",
        stage: "stripe_catalog_read",
        checkpoint: "stripe_products_read",
        error_class: "SafeCatalogMappingError",
        provider_status: 403,
        provider_code: "permission_denied",
        timestamp: "2026-07-04T00:00:00.000Z",
        mode: "dry_run",
      });
      assertNoSensitiveLeak(diagnostic);
    });
  });

  it("writes redacted diagnostic files for unknown runtime failures without leaking raw errors", async () => {
    await withDiagnosticFile(async (diagnosticPath) => {
      const result = await runCliWithFake({
        fake: new FakeStripeCatalogClient({
          productListError: leakyRuntimeError(),
        }),
        env: {
          STRIPE_SECRET_KEY: FAKE_TEST_KEY,
          SUPABASE_URL: "https://zgafnshkjywfltxgbtzg.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "local-service-role-placeholder",
          STRIPE_MAPPING_DIAGNOSTIC_FILE: diagnosticPath,
        },
        now: () => new Date("2026-07-04T00:01:00.000Z"),
      });
      assert.equal(result.exitCode, 2);
      const diagnostic = JSON.parse(await readFile(diagnosticPath, "utf8"));
      assert.deepEqual(diagnostic, {
        ok: false,
        code: "unexpected_sync_failure",
        stage: "validation",
        checkpoint: "stripe_products_read",
        error_class: "TypeError",
        timestamp: "2026-07-04T00:01:00.000Z",
        mode: "dry_run",
      });
      assertNoSensitiveLeak(diagnostic);
    });
  });

  it("keeps the executable CLI preflight diagnostic path free of top-level TDZ failures", async () => {
    await withDiagnosticFile(async (diagnosticPath) => {
      const result = spawnSync(
        process.execPath,
        ["scripts/stripe-sync-public-catalog-mapping.mjs"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            PATH: process.env.PATH ?? "",
            STRIPE_MAPPING_DIAGNOSTIC_FILE: diagnosticPath,
          },
        },
      );
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.doesNotMatch(result.stderr, /ReferenceError|ALLOWED_ERROR_CLASSES/);
      const failureLine = result.stderr.trim().split(/\n/).at(-1);
      assert.deepEqual(JSON.parse(failureLine), {
        ok: false,
        code: "stripe_test_key_required",
        stage: "validation",
        checkpoint: "cli_preflight",
      });

      const diagnostic = JSON.parse(await readFile(diagnosticPath, "utf8"));
      assert.equal(diagnostic.ok, false);
      assert.equal(diagnostic.code, "stripe_test_key_required");
      assert.equal(diagnostic.stage, "validation");
      assert.equal(diagnostic.checkpoint, "cli_preflight");
      assert.equal(diagnostic.error_class, "SafeCatalogMappingError");
      assert.equal(diagnostic.mode, "dry_run");
      assert.match(diagnostic.timestamp, /^\d{4}-\d{2}-\d{2}T/);
      assertNoSensitiveLeak(diagnostic);
    });
  });

  it("keeps the operator wrapper autonomous, dry-run only, and documented", async () => {
    const script = await readFile("scripts/stripe-mapping-dry-run-operator.sh", "utf8");
    assert.match(script, /STRIPE_MAPPING_DIAGNOSTIC_FILE/);
    assert.match(script, /trap cleanup EXIT/);
    assert.match(script, /prompt_secret "STRIPE_SECRET_KEY"/);
    assert.match(script, /read -r -s -p/);
    assert.match(script, /node "\$\{REPO_ROOT\}\/scripts\/stripe-sync-public-catalog-mapping\.mjs"/);
    assert.match(script, /refuses all positional arguments/);
    assert.equal(/node .*\s--apply\b/.test(script), false);
    assert.equal(/\bstatus=|\$status|\$\{status/.test(script), false);
    assert.equal(script.includes(LEAKY_SECRET), false);
  });
});
