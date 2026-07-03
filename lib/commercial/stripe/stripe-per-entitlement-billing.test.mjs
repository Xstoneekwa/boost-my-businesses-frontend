import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildCommercialPricingSnapshot } from "../pricing-snapshot.ts";
import {
  assertStripePublicCatalogShape,
  buildStripePublicPricesManifest,
  STRIPE_PUBLIC_PRODUCT_NAMES,
} from "./stripe-public-catalog-manifest.ts";
import {
  buildEntitlementStripeMetadata,
  componentsFromPricingSnapshot,
  isPublicCatalogComponent,
  validateEntitlementBillingBinding,
} from "./stripe-per-entitlement-billing.ts";
import {
  assertProvisionerKeyMatchesEnvironment,
  buildStripeCatalogProvisionerPlan,
  redactProvisionerReport,
} from "./stripe-catalog-provisioner.ts";

function snapshot(input = {}) {
  const result = buildCommercialPricingSnapshot({
    planKey: input.planKey ?? "pro",
    billingIntervalMonths: input.billingIntervalMonths ?? 1,
    outreachAddonKey: input.outreachAddonKey ?? null,
    linkedAccountCount: input.linkedAccountCount ?? 0,
    reservedEntitlementCount: input.reservedEntitlementCount ?? 0,
    pricingContext: input.pricingContext ?? "first_purchase",
  });
  assert.ok(!("error" in result), "snapshot should be valid");
  return result;
}

function binding(input = {}) {
  return {
    clientId: input.clientId ?? "client-1",
    entitlementId: input.entitlementId ?? "entitlement-1",
    accountId: input.accountId ?? null,
    commercialMode: input.commercialMode ?? "full_cycle",
    pricingSnapshotFingerprint: input.pricingSnapshotFingerprint ?? "fp-1",
    pricingMode: input.pricingMode ?? "public_catalog",
    components: input.components ?? componentsFromPricingSnapshot(snapshot({ outreachAddonKey: "outreach_standard" }), "full_cycle"),
  };
}

describe("per-entitlement outreach exclusivity", () => {
  it("allows one client to own Standard, Standard and AI across different entitlements", () => {
    const standardA = validateEntitlementBillingBinding(binding({ entitlementId: "A" }));
    const standardB = validateEntitlementBillingBinding(binding({ entitlementId: "B" }));
    const aiComponents = componentsFromPricingSnapshot(snapshot({ outreachAddonKey: "outreach_ai" }), "full_cycle");
    const aiC = validateEntitlementBillingBinding(binding({ entitlementId: "C", components: aiComponents }));
    assert.equal(standardA.ok, true);
    assert.equal(standardB.ok, true);
    assert.equal(aiC.ok, true);
  });

  it("rejects two outreach components and two package components on the same entitlement", () => {
    const base = componentsFromPricingSnapshot(snapshot({ outreachAddonKey: "outreach_standard" }), "full_cycle");
    const withTwoOutreach = validateEntitlementBillingBinding(binding({
      components: [...base, { ...base.find((component) => component.componentKind === "outreach"), outreachKey: "outreach_ai" }],
    }));
    assert.equal(withTwoOutreach.ok, false);
    assert.equal(withTwoOutreach.code, "multiple_outreach");

    const packageComponent = base.find((component) => component.componentKind === "package");
    const withTwoPackages = validateEntitlementBillingBinding(binding({
      components: [...base, { ...packageComponent, packageKey: "growth", productKey: "boost_ai_growth" }],
    }));
    assert.equal(withTwoPackages.ok, false);
    assert.equal(withTwoPackages.code, "multiple_packages");
  });
});

describe("full_cycle and outreach_only billing shapes", () => {
  it("requires package for full_cycle and allows optional outreach", () => {
    const withoutOutreach = componentsFromPricingSnapshot(snapshot(), "full_cycle");
    assert.equal(withoutOutreach.length, 1);
    assert.equal(validateEntitlementBillingBinding(binding({ components: withoutOutreach })).ok, true);

    const outreachOnlyComponent = componentsFromPricingSnapshot(snapshot({ outreachAddonKey: "outreach_standard" }), "full_cycle")
      .filter((component) => component.componentKind === "outreach");
    const invalid = validateEntitlementBillingBinding(binding({ components: outreachOnlyComponent }));
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, "full_cycle_package_required");
  });

  it("requires one outreach and forbids package for outreach_only", () => {
    const withPackage = validateEntitlementBillingBinding(binding({ commercialMode: "outreach_only" }));
    assert.equal(withPackage.ok, false);
    assert.equal(withPackage.code, "outreach_only_package_forbidden");

    const outreachOnly = componentsFromPricingSnapshot(snapshot({ outreachAddonKey: "outreach_ai" }), "full_cycle")
      .filter((component) => component.componentKind === "outreach");
    const valid = validateEntitlementBillingBinding(binding({ commercialMode: "outreach_only", components: outreachOnly }));
    assert.equal(valid.ok, true);
  });

  it("rejects package and outreach interval mismatch", () => {
    const components = componentsFromPricingSnapshot(snapshot({ outreachAddonKey: "outreach_ai" }), "full_cycle");
    components[1] = { ...components[1], billingIntervalMonths: 3 };
    const invalid = validateEntitlementBillingBinding(binding({ components }));
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, "component_interval_mismatch");
  });
});

describe("entitlement lifecycle and A/B isolation", () => {
  it("allows reserved entitlement without account and requires account for plan change", () => {
    const reserved = validateEntitlementBillingBinding(binding({ accountId: null }));
    assert.equal(reserved.ok, true);
    const planChange = validateEntitlementBillingBinding(binding({ accountId: null }), { requireAccountIdForPlanChange: true });
    assert.equal(planChange.ok, false);
    assert.equal(planChange.code, "plan_change_account_required");
  });

  it("keeps subscription identity scoped to one entitlement", () => {
    const a = binding({ entitlementId: "entitlement-A", accountId: "account-A" });
    const b = binding({ entitlementId: "entitlement-B", accountId: "account-B" });
    assert.notEqual(a.entitlementId, b.entitlementId);
    assert.notEqual(a.accountId, b.accountId);
    assert.equal(validateEntitlementBillingBinding(a, { requireAccountIdForPlanChange: true }).ok, true);
    assert.equal(validateEntitlementBillingBinding(b, { requireAccountIdForPlanChange: true }).ok, true);
  });
});

describe("public catalog and immutable snapshot pricing", () => {
  it("exposes five exact product names and twenty separated public prices", () => {
    const shape = assertStripePublicCatalogShape();
    assert.equal(shape.ok, true);
    assert.deepEqual(shape.productNames, Object.values(STRIPE_PUBLIC_PRODUCT_NAMES));
    assert.equal(buildStripePublicPricesManifest().length, 20);
  });

  it("uses immutable snapshot component amounts for agency pricing without coupons", () => {
    const agencySnapshot = snapshot({
      planKey: "premium",
      outreachAddonKey: "outreach_ai",
      billingIntervalMonths: 12,
      linkedAccountCount: 51,
      pricingContext: "new_account",
    });
    assert.equal(agencySnapshot.billableAccountCount > 0, true);
    assert.equal(agencySnapshot.discountRule, "best_single_discount_only");
    assert.equal(agencySnapshot.tieBreakRule, "duration_wins_on_equal_percent");
    const components = componentsFromPricingSnapshot(agencySnapshot, "full_cycle");
    assert.equal(components.length, 2);
    assert.equal(components.every((component) => component.amountCents > 0), true);
    assert.equal(components.every(isPublicCatalogComponent), false);
    const metadata = buildEntitlementStripeMetadata({
      clientId: "client-1",
      entitlementId: "entitlement-1",
      pricingSnapshotFingerprint: "fp-1",
      componentKind: "package",
      commercialMode: "full_cycle",
    });
    assert.deepEqual(Object.keys(metadata).sort(), [
      "client_id",
      "commercial_mode",
      "component_kind",
      "entitlement_id",
      "pricing_snapshot_fingerprint",
    ]);
  });
});

describe("provisioner and source hardening", () => {
  it("is dry-run by default and separates test/live key prefixes", () => {
    const plan = buildStripeCatalogProvisionerPlan({ environment: "test" });
    assert.equal(plan.mode, "dry_run");
    assert.equal(redactProvisionerReport(plan).priceCount, 20);
    assert.equal(assertProvisionerKeyMatchesEnvironment({ environment: "test", secretKeyPrefix: "sk_live" }).ok, false);
    assert.equal(assertProvisionerKeyMatchesEnvironment({ environment: "live", secretKeyPrefix: "sk_test" }).ok, false);
  });

  it("checkout source uses multi-item line_items and omits payment_method_types", () => {
    const subscriptionSource = readFileSync(new URL("./stripe-subscription-checkout.ts", import.meta.url), "utf8");
    assert.match(subscriptionSource, /line_items: lineItems\.lineItems/);
    assert.doesNotMatch(subscriptionSource, /payment_method_types/);
    assert.match(subscriptionSource, /componentsFromPricingSnapshot/);
  });

  it("plan-change source stays per-account and one-off amount_due only", () => {
    const source = readFileSync(new URL("./stripe-plan-change-checkout.ts", import.meta.url), "utf8");
    assert.match(source, /per_account/);
    assert.match(source, /amountDueCents/);
    assert.match(source, /client_account_entitlement_id|clientAccountEntitlementId/);
    assert.doesNotMatch(source, /payment_method_types/);
    assert.doesNotMatch(source, /coupon|promotion_code|customer_balance/);
  });
});
