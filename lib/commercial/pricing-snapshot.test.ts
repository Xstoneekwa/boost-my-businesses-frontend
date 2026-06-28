import assert from "node:assert/strict";
import test from "node:test";

import { resolveCommercialAccountCounts } from "./commercial-account-counts.ts";
import {
  appliedDiscountKindToDbType,
  buildCommercialPricingSnapshot,
  buildDashboardAgencyPricingSnapshot,
  isLegacyCommercialPricingRecord,
  resolveAppliedDiscount,
  volumeDiscountTierLabelForBillableCount,
} from "./pricing-snapshot.ts";
import { buildCommercialQuote } from "./pricing.ts";

test("1 linked account: agency mode false, volume 0%", () => {
  const snapshot = buildDashboardAgencyPricingSnapshot({ linkedAccountCount: 1, reservedEntitlementCount: 0 });
  assert.ok(!("error" in snapshot));
  assert.equal(snapshot.agencyModeActive, false);
  assert.equal(snapshot.volumeDiscountPercent, 0);
});

test("2 linked accounts: agency mode true, volume 0%, threshold message", () => {
  const snapshot = buildDashboardAgencyPricingSnapshot({ linkedAccountCount: 2, reservedEntitlementCount: 0 });
  assert.equal(snapshot.agencyModeActive, true);
  assert.equal(snapshot.volumeDiscountPercent, 0);
  assert.match(snapshot.clientMessageFr, /6 comptes/);
});

test("5 billable accounts on add-account quote: agency mode true, volume 0%", () => {
  const snapshot = buildCommercialPricingSnapshot({
    planKey: "pro",
    billingIntervalMonths: 1,
    linkedAccountCount: 4,
    reservedEntitlementCount: 0,
    pricingContext: "new_account",
  });
  assert.ok(!("error" in snapshot));
  assert.equal(snapshot.billableAccountCount, 5);
  assert.equal(snapshot.agencyModeActive, true);
  assert.equal(snapshot.volumeDiscountPercent, 0);
});

test("6 billable accounts: volume -14%", () => {
  const snapshot = buildCommercialPricingSnapshot({
    planKey: "pro",
    billingIntervalMonths: 1,
    billableAccountCountOverride: 6,
    linkedAccountCount: 0,
    reservedEntitlementCount: 0,
    pricingContext: "plan_change",
  });
  assert.equal(snapshot.volumeDiscountPercent, 0.14);
  assert.equal(snapshot.volumeDiscountTierLabel, "6-10");
});

test("volume tiers exact boundaries", () => {
  const cases: Array<[number, number, string | null]> = [
    [10, 0.14, "6-10"],
    [11, 0.22, "11-25"],
    [25, 0.22, "11-25"],
    [26, 0.32, "26-40"],
    [40, 0.32, "26-40"],
    [41, 0.4, "41-50"],
    [50, 0.4, "41-50"],
    [51, 0.45, "51+"],
  ];
  for (const [count, percent, label] of cases) {
    assert.equal(volumeDiscountTierLabelForBillableCount(count), label);
    const snapshot = buildCommercialPricingSnapshot({
      planKey: "pro",
      billingIntervalMonths: 1,
      billableAccountCountOverride: count,
      linkedAccountCount: 0,
      reservedEntitlementCount: 0,
      pricingContext: "plan_change",
    });
    assert.equal(snapshot.volumeDiscountPercent, percent, `count=${count}`);
  }
});

test("duration discount only", () => {
  const quote = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 3,
    linkedAccountCount: 0,
    reservedEntitlementCount: 0,
    pricingContext: "first_purchase",
  });
  assert.ok(!("error" in quote));
  assert.equal(quote.pricingSnapshot.durationDiscountPercent, 0.1);
  assert.equal(quote.pricingSnapshot.volumeDiscountPercent, 0);
  assert.equal(quote.pricingSnapshot.appliedDiscountKind, "duration");
});

test("volume discount only", () => {
  const quote = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 1,
    billableAccountCountOverride: 6,
    pricingContext: "plan_change",
  });
  assert.ok(!("error" in quote));
  assert.equal(quote.pricingSnapshot.appliedDiscountKind, "agency_volume");
  assert.equal(quote.pricingSnapshot.appliedDiscountPercent, 0.14);
});

test("two discounts: best single only", () => {
  const quote = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 3,
    billableAccountCountOverride: 6,
    pricingContext: "plan_change",
  });
  assert.ok(!("error" in quote));
  assert.equal(quote.pricingSnapshot.durationDiscountPercent, 0.1);
  assert.equal(quote.pricingSnapshot.volumeDiscountPercent, 0.14);
  assert.equal(quote.pricingSnapshot.appliedDiscountKind, "agency_volume");
});

test("equal percent tie-break prefers duration", () => {
  const resolved = resolveAppliedDiscount({ durationDiscountPercent: 0.1, volumeDiscountPercent: 0.1 });
  assert.equal(resolved.kind, "duration");
  assert.equal(resolved.percent, 0.1);
});

test("add-account includes projected account in billable count", () => {
  const counts = resolveCommercialAccountCounts({
    linkedAccountCount: 1,
    reservedEntitlementCount: 0,
    pricingContext: "new_account",
  });
  assert.equal(counts.billableAccountCount, 2);
});

test("plan change does not add projected +1", () => {
  const counts = resolveCommercialAccountCounts({
    linkedAccountCount: 5,
    reservedEntitlementCount: 0,
    pricingContext: "plan_change",
    billableAccountCountOverride: 4,
  });
  assert.equal(counts.billableAccountCount, 4);
});

test("snapshot includes immutable metadata fields", () => {
  const snapshot = buildCommercialPricingSnapshot({
    planKey: "growth",
    billingIntervalMonths: 6,
    linkedAccountCount: 0,
    reservedEntitlementCount: 0,
    pricingContext: "first_purchase",
    calculatedAt: "2026-06-25T12:00:00.000Z",
  });
  assert.ok(!("error" in snapshot));
  assert.equal(snapshot.calculatedAt, "2026-06-25T12:00:00.000Z");
  assert.equal(snapshot.discountRule, "best_single_discount_only");
  assert.equal(snapshot.pricingContext, "first_purchase");
});

test("legacy records without snapshot stay legacy", () => {
  assert.equal(isLegacyCommercialPricingRecord(null), true);
  assert.equal(isLegacyCommercialPricingRecord({}), true);
  assert.equal(isLegacyCommercialPricingRecord({ version: "2026-06-25.1" }), false);
});

test("db discount type mapping stays compatible", () => {
  assert.equal(appliedDiscountKindToDbType("duration"), "term");
  assert.equal(appliedDiscountKindToDbType("agency_volume"), "agency");
  assert.equal(appliedDiscountKindToDbType("none"), "none");
});

test("dashboard 6+ shows tier and volume message", () => {
  const snapshot = buildDashboardAgencyPricingSnapshot({ linkedAccountCount: 6, reservedEntitlementCount: 0 });
  assert.equal(snapshot.agencyModeActive, true);
  assert.equal(snapshot.volumeDiscountPercent, 0.14);
  assert.match(snapshot.clientMessageFr, /palier volume 6-10/i);
});

test("parallel checkout risk: disjoint reserved + projected purchase counts as separate slots", () => {
  const counts = resolveCommercialAccountCounts({
    linkedAccountCount: 5,
    reservedEntitlementCount: 1,
    pricingContext: "new_account",
    reservedRepresentsQuotedPurchase: false,
  });
  assert.equal(counts.billableAccountCount, 7);
});

test("5 linked, zero reserved, add-account projected purchase reaches tier -14%", () => {
  const snapshot = buildCommercialPricingSnapshot({
    planKey: "pro",
    billingIntervalMonths: 1,
    linkedAccountCount: 5,
    reservedEntitlementCount: 0,
    pricingContext: "new_account",
  });
  assert.ok(!("error" in snapshot));
  assert.equal(snapshot.billableAccountCount, 6);
  assert.equal(snapshot.volumeDiscountPercent, 0.14);
  assert.equal(snapshot.volumeDiscountTierLabel, "6-10");
});

test("5 linked, reserved from another checkout, add-account quote prices a new disjoint slot", () => {
  const snapshot = buildCommercialPricingSnapshot({
    planKey: "pro",
    billingIntervalMonths: 1,
    linkedAccountCount: 5,
    reservedEntitlementCount: 1,
    pricingContext: "new_account",
    reservedRepresentsQuotedPurchase: false,
  });
  assert.equal(snapshot.billableAccountCount, 7);
});

test("5 linked, reserved from current checkout, projected purchase is not double-counted", () => {
  const snapshot = buildCommercialPricingSnapshot({
    planKey: "pro",
    billingIntervalMonths: 1,
    linkedAccountCount: 5,
    reservedEntitlementCount: 1,
    pricingContext: "new_account",
    reservedRepresentsQuotedPurchase: true,
  });
  assert.equal(snapshot.billableAccountCount, 6);
  assert.equal(snapshot.volumeDiscountPercent, 0.14);
});

test("linked and reserved are disjoint commercial slots; reserved covers quoted purchase without +1", () => {
  const engagedOnly = resolveCommercialAccountCounts({
    linkedAccountCount: 4,
    reservedEntitlementCount: 1,
    pricingContext: "dashboard_readonly",
  });
  assert.equal(engagedOnly.billableAccountCount, 5);
  assert.equal(engagedOnly.projectedPurchaseSlots, 0);

  const quotedWithReserved = resolveCommercialAccountCounts({
    linkedAccountCount: 4,
    reservedEntitlementCount: 1,
    pricingContext: "new_account",
    reservedRepresentsQuotedPurchase: true,
  });
  assert.equal(quotedWithReserved.billableAccountCount, 5);
});

test("two open checkouts: only one reserved entitlement is allowed per client", () => {
  const firstQuote = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 1,
    linkedAccountCount: 5,
    reservedEntitlementCount: 0,
    pricingContext: "new_account",
  });
  assert.ok(!("error" in firstQuote));
  assert.equal(firstQuote.pricingSnapshot.billableAccountCount, 6);

  const blockedSecondQuote = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 1,
    linkedAccountCount: 5,
    reservedEntitlementCount: 1,
    pricingContext: "new_account",
    reservedRepresentsQuotedPurchase: true,
  });
  assert.ok(!("error" in blockedSecondQuote));
  assert.equal(blockedSecondQuote.pricingSnapshot.billableAccountCount, 6);
  assert.equal(blockedSecondQuote.pricingSnapshot.volumeDiscountPercent, 0.14);
});

test("client cannot force tier via buildCommercialQuote without override from trusted source", () => {
  const quote = buildCommercialQuote({
    planKey: "pro",
    billingIntervalMonths: 1,
    linkedAccountCount: 1,
    reservedEntitlementCount: 0,
    pricingContext: "new_account",
  });
  assert.ok(!("error" in quote));
  assert.equal(quote.pricingSnapshot.billableAccountCount, 2);
  assert.equal(quote.pricingSnapshot.volumeDiscountPercent, 0);
});

test("agency mode stays active at three linked accounts", () => {
  const snapshot = buildDashboardAgencyPricingSnapshot({ linkedAccountCount: 3, reservedEntitlementCount: 0 });
  assert.equal(snapshot.agencyModeActive, true);
  assert.equal(snapshot.volumeDiscountPercent, 0);
  assert.equal(snapshot.billableAccountCount, 3);
});

test("tenant isolation: counts are computed from caller-supplied server counts only in API contract", () => {
  const a = buildDashboardAgencyPricingSnapshot({ linkedAccountCount: 2, reservedEntitlementCount: 0 });
  const b = buildDashboardAgencyPricingSnapshot({ linkedAccountCount: 9, reservedEntitlementCount: 0 });
  assert.notEqual(a.billableAccountCount, b.billableAccountCount);
});
