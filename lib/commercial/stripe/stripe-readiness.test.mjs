import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildStripePublicPricesManifest } from "./stripe-public-catalog-manifest.ts";
import { createStripeSubscriptionCheckoutSession } from "./stripe-subscription-checkout.ts";
import {
  getStripeTestReadiness,
  isStripeTestFoundationReady,
} from "./stripe-readiness.ts";

const TEST_ENV = {
  STRIPE_SECRET_KEY: ["sk", "test", "readiness", "fake"].join("_"),
  STRIPE_WEBHOOK_SECRET: "whsec_fake",
  STRIPE_TEST_CHECKOUT_ENABLED: "true",
  CHECKOUT_SIGNUP_CREDENTIAL_SECRET: "test-checkout-signup-secret-32bytes-min!!",
};

function componentRows(overrides = {}) {
  return buildStripePublicPricesManifest().map((entry, index) => ({
    id: `map-${index + 1}`,
    environment: "test",
    product_key: entry.productKey,
    component_kind: entry.componentKind,
    package_key: entry.packageKey,
    outreach_key: entry.outreachKey,
    billing_interval_months: entry.billingIntervalMonths,
    stripe_product_id: `prod_${entry.productKey.replaceAll("_", "")}`,
    stripe_price_id: `price_${entry.productKey.replaceAll("_", "")}${entry.billingIntervalMonths}`,
    expected_amount_cents: entry.unitAmountCents,
    currency: "eur",
    active: true,
    catalog_version: entry.catalogVersion,
    ...overrides,
  }));
}

function createCountSupabase(tables) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      const filters = [];
      let countHead = false;
      const api = {
        select(_columns, opts) {
          countHead = opts?.count === "exact" && opts?.head === true;
          return api;
        },
        eq(column, value) {
          filters.push({ column, value });
          return api;
        },
        then(resolve, reject) {
          const matched = rows.filter((row) => filters.every(({ column, value }) => row[column] === value));
          if (countHead) {
            return Promise.resolve({ data: null, error: null, count: matched.length }).then(resolve, reject);
          }
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

function createFakeStripe() {
  const calls = { checkoutCreate: [] };
  return {
    calls,
    checkout: {
      sessions: {
        create: async (payload) => {
          calls.checkoutCreate.push({ payload });
          return { id: "cs_test_readiness", url: "https://checkout.stripe.test/c/pay", expires_at: Math.floor(Date.now() / 1000) + 3600, customer: "cus_test" };
        },
      },
    },
    customers: {
      create: async () => ({ id: "cus_test" }),
    },
  };
}

describe("stripe readiness component catalog contract", () => {
  it("treats legacy-empty + component catalog populated as ready", async () => {
    const readiness = await getStripeTestReadiness(createCountSupabase({
      commercial_stripe_price_catalog: [],
      commercial_stripe_component_price_catalog: componentRows(),
    }), TEST_ENV);
    assert.equal(readiness.testCatalogMappingsCount, componentRows().length);
    assert.equal(isStripeTestFoundationReady(readiness), true);
  });

  it("fails closed when the component catalog is empty even if legacy rows exist", async () => {
    const readiness = await getStripeTestReadiness(createCountSupabase({
      commercial_stripe_price_catalog: [{ id: "legacy-1", environment: "test", active: true }],
      commercial_stripe_component_price_catalog: [],
    }), TEST_ENV);
    assert.equal(readiness.testCatalogMappingsCount, 0);
    assert.equal(isStripeTestFoundationReady(readiness), false);
  });

  it("ignores live component rows when counting test readiness", async () => {
    const readiness = await getStripeTestReadiness(createCountSupabase({
      commercial_stripe_component_price_catalog: componentRows({ environment: "live" }),
    }), TEST_ENV);
    assert.equal(readiness.testCatalogMappingsCount, 0);
    assert.equal(isStripeTestFoundationReady(readiness), false);
  });

  it("reads readiness from the canonical component catalog source", () => {
    const source = readFileSync(new URL("./stripe-readiness.ts", import.meta.url), "utf8");
    assert.match(source, /countActiveStripeComponentPriceCatalogMappings/);
    assert.doesNotMatch(source, /countActiveStripePriceCatalogMappings/);
  });
});

describe("stripe readiness checkout integration", () => {
  it("blocks create-session without writes when the component catalog is empty", async () => {
    const tables = {
      commercial_stripe_price_catalog: [{ id: "legacy-1", environment: "test", active: true }],
      commercial_stripe_component_price_catalog: [],
      commercial_checkout_sessions: [],
      commercial_stripe_checkout_attempts: [],
    };
    const stripe = createFakeStripe();
    const supabase = createCountSupabase(tables);
    supabase.from = ((original) => function patched(table) {
      if (table === "commercial_checkout_sessions" || table === "commercial_stripe_checkout_attempts") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "blocked" } }) }) }),
          }),
          insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "blocked" } }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return original.call(this, table);
    })(supabase.from);

    const result = await createStripeSubscriptionCheckoutSession(supabase, {
      commercialTestMode: "stripe_test",
      realStripeTestE2E: true,
      commercialMode: "full_cycle",
      packageKey: "pro",
      planKey: "pro",
      billingIntervalMonths: 3,
      outreachAddonKey: null,
      purchaserEmail: "client@example.com",
      flowType: "additional_account",
      idempotencyKey: "readiness-empty-component",
      clientId: "client-1",
      successUrl: "https://app.example.test/commercial/stripe-test/success?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://app.example.test/commercial/stripe-test/cancel",
      allowedOrigins: ["https://app.example.test"],
      stripe,
    }, TEST_ENV);

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.code, "stripe_test_not_configured");
    assert.match(result.messageEn, /incomplete/i);
    assert.equal(stripe.calls.checkoutCreate.length, 0);
    assert.equal(tables.commercial_checkout_sessions.length, 0);
    assert.equal(tables.commercial_stripe_checkout_attempts.length, 0);
  });
});
