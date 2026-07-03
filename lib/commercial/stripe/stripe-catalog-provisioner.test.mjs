import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStripePublicCatalog,
  buildStripeCatalogProvisionerPlan,
  redactProvisionerReport,
} from "./stripe-catalog-provisioner.ts";
import { buildStripePublicPricesManifest } from "./stripe-public-catalog-manifest.ts";

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

const FAKE_TEST_KEY = ["sk", "test", "fake", "123"].join("_");
const FAKE_LIVE_KEY = ["sk", "live", "secret", "value", "never", "reported"].join("_");

async function applyWithFake(fake, secretKey = FAKE_TEST_KEY) {
  return applyStripePublicCatalog({
    environment: "test",
    mode: "apply",
    secretKey,
    client: fake,
  });
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
