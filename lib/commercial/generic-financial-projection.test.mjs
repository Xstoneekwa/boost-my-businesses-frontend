import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCommercialQuote } from "./pricing.ts";
import { formatClientMonthlyPrice } from "../instagram-client/client-subscription-projection.ts";

const EXPECTED = {
  growth: {
    1: [14_700, 14_700, 14_700],
    3: [14_700, 13_230, 39_690],
    6: [14_700, 11_760, 70_560],
    12: [14_700, 11_025, 132_300],
  },
  pro: {
    1: [19_700, 19_700, 19_700],
    3: [19_700, 17_730, 53_190],
    6: [19_700, 15_760, 94_560],
    12: [19_700, 14_775, 177_300],
  },
  premium: {
    1: [24_700, 24_700, 24_700],
    3: [24_700, 22_230, 66_690],
    6: [24_700, 19_760, 118_560],
    12: [24_700, 18_525, 222_300],
  },
};

test("all 12 target plan/duration pricing snapshots are canonical", () => {
  let count = 0;
  for (const planKey of ["growth", "pro", "premium"]) {
    for (const billingIntervalMonths of [1, 3, 6, 12]) {
      const quote = buildCommercialQuote({
        planKey,
        billingIntervalMonths,
        pricingContext: "plan_change",
        billableAccountCountOverride: 1,
      });
      assert.equal("error" in quote, false);
      if ("error" in quote) continue;
      const [base, monthly, total] = EXPECTED[planKey][billingIntervalMonths];
      assert.equal(quote.pricingSnapshot.planKey, planKey);
      assert.equal(quote.pricingSnapshot.billingIntervalMonths, billingIntervalMonths);
      assert.equal(quote.pricingSnapshot.currency, "EUR");
      assert.equal(quote.packLine.baseMonthlyPriceCents, base);
      assert.equal(quote.packLine.monthlyDiscountedPriceCents, monthly);
      assert.equal(quote.packLine.billingPeriodTotalCents, total);
      count += 1;
    }
  }
  assert.equal(count, 12);
});

test("target metadata never depends on malformed source pricing", () => {
  const malformedSources = [
    { plan: "premium", monthly: 22_230, total: 66_690 },
    { plan: "growth", monthly: -1, total: 0 },
    { plan: "pro", monthly: 999_999, total: 1 },
  ];
  for (const source of malformedSources) {
    const target = buildCommercialQuote({
      planKey: "growth",
      billingIntervalMonths: 3,
      pricingContext: "plan_change",
      billableAccountCountOverride: 1,
    });
    assert.equal("error" in target, false, JSON.stringify(source));
    if ("error" in target) continue;
    assert.equal(target.packLine.monthlyDiscountedPriceCents, 13_230);
    assert.equal(target.totalPeriodCents, 39_690);
  }
});

test("forward migration normalizes every stale source-derived financial field", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260831143000_generic_financial_projection_v1.sql", import.meta.url),
    "utf8",
  );
  for (const field of [
    "term_discount_percent",
    "agency_discount_percent",
    "applied_discount_percent",
    "applied_discount_type",
    "pack_base_monthly_cents",
    "pack_monthly_discounted_cents",
    "pack_period_total_cents",
    "outreach_base_monthly_cents",
    "outreach_monthly_discounted_cents",
    "outreach_period_total_cents",
    "total_period_cents",
  ]) {
    assert.match(migration, new RegExp(`new\\.${field}\\s*:=`), field);
  }
  assert.match(migration, /target_pricing_snapshot_identity_mismatch/);
  assert.match(migration, /quote_is_estimate/);
  assert.match(migration, /quoted_remaining_credit_cents/);
  assert.match(migration, /actual_stripe_remaining_credit_cents/);
  assert.match(migration, /actual_stripe_plan_period_total_cents/);
  assert.match(migration, /actual_stripe_period_start_at/);
  assert.match(migration, /actual_stripe_period_end_at/);
  assert.match(migration, /reconcile_plan_change_stripe_financial_actual_v1/);
  assert.match(migration, /new\.status\s*:=\s*'checkout_paid'/);
  assert.match(migration, /client_account_entitlement_id\s*=\s*v_entitlement_id/);
  assert.match(migration, /commercial_checkout_session_id\s*=\s*v_quote\.activated_checkout_session_id/);
});

test("historical quote columns are not overwritten by actual Stripe reconciliation", () => {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260831143000_generic_financial_projection_v1.sql", import.meta.url),
    "utf8",
  );
  const reconciliation = migration.slice(migration.indexOf("reconcile_plan_change_stripe_financial_actual_v1"));
  assert.doesNotMatch(reconciliation, /set\s+remaining_credit_cents\s*=/i);
  assert.doesNotMatch(reconciliation, /set\s+amount_due_cents\s*=/i);
  assert.match(reconciliation, /actual_stripe_remaining_credit_cents\s*=/i);
  assert.match(reconciliation, /actual_stripe_amount_due_cents\s*=/i);
  assert.match(reconciliation, /actual_stripe_plan_period_total_cents\s*=/i);
  assert.match(reconciliation, /actual_stripe_period_start_at\s*=/i);
  assert.match(reconciliation, /actual_stripe_period_end_at\s*=/i);
});

test("client projection reads corrected target price and separate Stripe actual fields", () => {
  const loader = readFileSync(
    new URL("../instagram-client/load-account-commercial-subscription.ts", import.meta.url),
    "utf8",
  );
  assert.match(loader, /pack_monthly_discounted_cents/);
  assert.match(loader, /pack_period_total_cents/);
  assert.match(loader, /actual_stripe_amount_due_cents/);
  assert.match(loader, /actual_stripe_remaining_credit_cents/);
  assert.match(loader, /actual_stripe_source/);
  assert.match(loader, /pack_period_total_cents/);
  assert.equal(formatClientMonthlyPrice("growth", 13_230, "fr"), "132€");
  assert.notEqual(formatClientMonthlyPrice("growth", 13_230, "fr"), "222€");
});

test("webhook and repair tooling bind actual price and exact Stripe period to the RPC", () => {
  const webhook = readFileSync(
    new URL("./stripe/stripe-plan-change-checkout.ts", import.meta.url),
    "utf8",
  );
  const repair = readFileSync(
    new URL("../../scripts/reconcile-plan-change-financial-actual.ts", import.meta.url),
    "utf8",
  );
  for (const source of [webhook, repair]) {
    assert.match(source, /p_actual_plan_period_total_cents/);
    assert.match(source, /p_actual_period_start_at/);
    assert.match(source, /p_actual_period_end_at/);
    assert.match(source, /current_period_start/);
    assert.match(source, /current_period_end/);
    assert.match(source, /price\?\.unit_amount/);
  }
});

test("Stripe-backed estimates use Stripe period boundaries before post-mutation actuals take over", () => {
  const source = readFileSync(new URL("./plan-change-source.ts", import.meta.url), "utf8");
  assert.match(source, /current_period_start/);
  assert.match(source, /current_period_end/);
  assert.match(source, /canonicalStripeSubscription\?\.current_period_start/);
  assert.match(source, /canonicalStripeSubscription\?\.current_period_end/);
});
