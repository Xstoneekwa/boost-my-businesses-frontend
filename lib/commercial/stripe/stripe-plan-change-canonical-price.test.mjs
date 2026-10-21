import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveCanonicalPackageStripePriceCatalogRow,
  resolveCanonicalPackageStripePriceId,
} from "./stripe-component-price-resolver.ts";

const MATRIX = [
  ["growth", 1, 14700, "price_1TpFHLFdctrIt9kb4ezGJDky"],
  ["growth", 3, 39690, "price_1TpFHLFdctrIt9kbmhzHkSGD"],
  ["growth", 6, 70560, "price_1TpFHMFdctrIt9kb1xdSvH3A"],
  ["growth", 12, 132300, "price_1TpFHNFdctrIt9kbyGnugqY6"],
  ["pro", 1, 19700, "price_1TpFHNFdctrIt9kbrp5g5AqL"],
  ["pro", 3, 53190, "price_1TpFHOFdctrIt9kb0ivzEqOH"],
  ["pro", 6, 94560, "price_1TpFHPFdctrIt9kbWJWVT6ax"],
  ["pro", 12, 177300, "price_1TpFHQFdctrIt9kbJOC22W9a"],
  ["premium", 1, 24700, "price_1TpFHQFdctrIt9kbAwCjGg02"],
  ["premium", 3, 66690, "price_1TpFHRFdctrIt9kbwk7tmQz2"],
  ["premium", 6, 118560, "price_1TpFHSFdctrIt9kbzAdM8t90"],
  ["premium", 12, 222300, "price_1TpFHSFdctrIt9kbqTPXuUE8"],
];

const PRODUCT_KEYS = {
  growth: "boost_ai_growth",
  pro: "boost_ai_pro",
  premium: "boost_ai_premium",
};

function rows() {
  return MATRIX.map(([planKey, months, amount, priceId], index) => ({
    id: `mapping-${index}`,
    environment: "test",
    product_key: PRODUCT_KEYS[planKey],
    component_kind: "package",
    package_key: planKey,
    outreach_key: null,
    billing_interval_months: months,
    stripe_product_id: `prod_${PRODUCT_KEYS[planKey]}`,
    stripe_price_id: priceId,
    expected_amount_cents: amount,
    currency: "eur",
    active: true,
    catalog_version: "2026-06-15.1",
  }));
}

function fakeSupabase(seedRows = rows()) {
  return {
    from(table) {
      assert.equal(table, "commercial_stripe_component_price_catalog");
      let selected = [...seedRows];
      const query = {
        select() { return query; },
        eq(column, value) {
          selected = selected.filter((row) => row[column] === value);
          return query;
        },
        async maybeSingle() {
          if (selected.length !== 1) return { data: null, error: { code: "cardinality" } };
          return { data: selected[0], error: null };
        },
      };
      return query;
    },
  };
}

test("all 12 package/duration tuples resolve through the canonical component catalog", async () => {
  const supabase = fakeSupabase();
  for (const [planKey, billingIntervalMonths, , expectedPriceId] of MATRIX) {
    const priceId = await resolveCanonicalPackageStripePriceId(supabase, {
      environment: "test",
      planKey,
      billingIntervalMonths,
    });
    assert.equal(priceId, expectedPriceId, `${planKey}/${billingIntervalMonths}m`);
  }
});

test("plan normalization and duration are canonical and preserved", async () => {
  const supabase = fakeSupabase();
  for (const planKey of ["growth", "pro", "premium"]) {
    for (const billingIntervalMonths of [1, 3, 6, 12]) {
      const row = await resolveCanonicalPackageStripePriceCatalogRow(supabase, {
        environment: "test",
        planKey,
        billingIntervalMonths,
      });
      assert.equal(row.product_key, PRODUCT_KEYS[planKey]);
      assert.equal(row.package_key, planKey);
      assert.equal(row.billing_interval_months, billingIntervalMonths);
      assert.equal(row.currency, "eur");
      assert.equal(row.active, true);
    }
  }
});

test("zero, duplicate, inactive, wrong-environment and wrong-identity mappings fail closed", async () => {
  const growth3 = rows().find((row) => row.package_key === "growth" && row.billing_interval_months === 3);
  const input = { environment: "test", planKey: "growth", billingIntervalMonths: 3 };
  assert.equal(await resolveCanonicalPackageStripePriceId(fakeSupabase([]), input), null);
  assert.equal(await resolveCanonicalPackageStripePriceId(fakeSupabase([growth3, { ...growth3, id: "duplicate" }]), input), null);
  assert.equal(await resolveCanonicalPackageStripePriceId(fakeSupabase([{ ...growth3, active: false }]), input), null);
  assert.equal(await resolveCanonicalPackageStripePriceId(fakeSupabase([{ ...growth3, environment: "live" }]), input), null);
  assert.equal(await resolveCanonicalPackageStripePriceId(fakeSupabase([{ ...growth3, product_key: "boost_ai_pro" }]), input), null);
  assert.equal(await resolveCanonicalPackageStripePriceId(fakeSupabase([{ ...growth3, billing_interval_months: 6 }]), input), null);
  assert.equal(await resolveCanonicalPackageStripePriceId(fakeSupabase([{ ...growth3, expected_amount_cents: 1 }]), input), null);
  assert.equal(await resolveCanonicalPackageStripePriceId(fakeSupabase([{ ...growth3, stripe_price_id: "not_a_price" }]), input), null);
});

test("quote, confirm/mutation and webhook reconciliation import one canonical resolver", () => {
  const quote = readFileSync(new URL("../plan-change-quote.ts", import.meta.url), "utf8");
  const confirmation = readFileSync(new URL("./stripe-plan-change-checkout.ts", import.meta.url), "utf8");
  assert.match(quote, /resolveCanonicalPackageStripePriceId/);
  assert.match(confirmation, /resolveCanonicalPackageStripePriceId/);
  assert.doesNotMatch(confirmation, /resolveServerStripePriceId|stripe-price-resolver/);
  assert.match(quote, /canonical_target_stripe_price_id/);
  assert.match(confirmation, /stripe_price_mapping_changed/);
});

test("required duration-preserving transitions target the canonical Price", async () => {
  const supabase = fakeSupabase();
  for (const sourcePlan of ["premium", "growth"]) {
    const targetPlan = sourcePlan === "premium" ? "growth" : "pro";
    for (const billingIntervalMonths of [1, 3, 6, 12]) {
      const expected = MATRIX.find(([plan, months]) => plan === targetPlan && months === billingIntervalMonths)[3];
      assert.equal(await resolveCanonicalPackageStripePriceId(supabase, {
        environment: "test",
        planKey: targetPlan,
        billingIntervalMonths,
      }), expected);
    }
  }
});
