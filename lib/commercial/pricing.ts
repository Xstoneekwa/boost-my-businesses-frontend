import {
  COMMERCIAL_PLANS,
  OUTREACH_ADDONS,
  type BillingIntervalMonths,
  type DiscountType,
  type OutreachAddonKey,
  type PlanKey,
} from "./catalog.ts";
import type { CommercialPricingContext } from "./commercial-account-counts.ts";
import {
  appliedDiscountKindToDbType,
  buildCommercialPricingSnapshot,
  snapshotCatalogEnvelope,
  type CommercialPricingSnapshot,
} from "./pricing-snapshot.ts";

export type QuoteLine = {
  lineKey: "pack" | "outreach";
  label: string;
  baseMonthlyPriceCents: number;
  discountPercent: number;
  discountType: DiscountType;
  monthlyDiscountedPriceCents: number;
  billingIntervalMonths: BillingIntervalMonths;
  billingPeriodTotalCents: number;
};

export type CommercialQuote = {
  planKey: PlanKey;
  billingIntervalMonths: BillingIntervalMonths;
  outreachAddonKey: OutreachAddonKey | null;
  billableAccountCount: number;
  termDiscountPercent: number;
  agencyDiscountPercent: number;
  appliedDiscountPercent: number;
  appliedDiscountType: DiscountType;
  packLine: QuoteLine;
  outreachLine: QuoteLine | null;
  totalPeriodCents: number;
  catalogSnapshot: ReturnType<typeof snapshotCatalogEnvelope>;
  pricingSnapshot: CommercialPricingSnapshot;
};

function buildQuoteLineFromSnapshot(input: {
  lineKey: "pack" | "outreach";
  label: string;
  baseMonthlyPriceCents: number;
  billingIntervalMonths: BillingIntervalMonths;
  discountPercent: number;
  discountType: DiscountType;
  monthlyDiscountedPriceCents: number;
  billingPeriodTotalCents: number;
}): QuoteLine {
  return {
    lineKey: input.lineKey,
    label: input.label,
    baseMonthlyPriceCents: input.baseMonthlyPriceCents,
    discountPercent: input.discountPercent,
    discountType: input.discountType,
    monthlyDiscountedPriceCents: input.monthlyDiscountedPriceCents,
    billingIntervalMonths: input.billingIntervalMonths,
    billingPeriodTotalCents: input.billingPeriodTotalCents,
  };
}

export function buildCommercialQuote(input: {
  planKey: string;
  billingIntervalMonths: number;
  outreachAddonKey?: string | null;
  billableAccountCount?: number;
  linkedAccountCount?: number;
  reservedEntitlementCount?: number;
  pricingContext?: CommercialPricingContext;
  billableAccountCountOverride?: number | null;
  reservedRepresentsQuotedPurchase?: boolean;
}): CommercialQuote | { ok: false; error: string } {
  const pricingContext = input.pricingContext
    ?? (input.billableAccountCount != null && input.linkedAccountCount == null
      ? "plan_change"
      : "first_purchase");

  const linkedAccountCount = input.linkedAccountCount ?? 0;
  const reservedEntitlementCount = input.reservedEntitlementCount ?? 0;

  const snapshotResult = buildCommercialPricingSnapshot({
    planKey: input.planKey,
    billingIntervalMonths: input.billingIntervalMonths,
    outreachAddonKey: input.outreachAddonKey,
    linkedAccountCount,
    reservedEntitlementCount,
    pricingContext,
    billableAccountCountOverride: input.billableAccountCountOverride ?? input.billableAccountCount ?? null,
    reservedRepresentsQuotedPurchase: input.reservedRepresentsQuotedPurchase,
  });

  if ("error" in snapshotResult) {
    return snapshotResult;
  }

  const snapshot = snapshotResult;
  const appliedDiscountType = appliedDiscountKindToDbType(snapshot.appliedDiscountKind);
  const plan = COMMERCIAL_PLANS[snapshot.planKey];
  const outreachAddon = snapshot.outreachAddonKey ? OUTREACH_ADDONS[snapshot.outreachAddonKey] : null;

  const packLine = buildQuoteLineFromSnapshot({
    lineKey: "pack",
    label: plan.displayName,
    baseMonthlyPriceCents: snapshot.packBaseMonthlyCents,
    billingIntervalMonths: snapshot.billingIntervalMonths,
    discountPercent: snapshot.appliedDiscountPercent,
    discountType: appliedDiscountType,
    monthlyDiscountedPriceCents: snapshot.packFinalMonthlyCents,
    billingPeriodTotalCents: snapshot.packPeriodTotalCents,
  });

  const outreachLine = outreachAddon
    ? buildQuoteLineFromSnapshot({
      lineKey: "outreach",
      label: outreachAddon.displayNameFr,
      baseMonthlyPriceCents: snapshot.outreachBaseMonthlyCents ?? outreachAddon.baseMonthlyPriceCents,
      billingIntervalMonths: snapshot.billingIntervalMonths,
      discountPercent: snapshot.appliedDiscountPercent,
      discountType: appliedDiscountType,
      monthlyDiscountedPriceCents: snapshot.outreachFinalMonthlyCents ?? outreachAddon.baseMonthlyPriceCents,
      billingPeriodTotalCents: snapshot.outreachPeriodTotalCents ?? 0,
    })
    : null;

  return {
    planKey: snapshot.planKey,
    billingIntervalMonths: snapshot.billingIntervalMonths,
    outreachAddonKey: snapshot.outreachAddonKey,
    billableAccountCount: snapshot.billableAccountCount,
    termDiscountPercent: snapshot.durationDiscountPercent,
    agencyDiscountPercent: snapshot.volumeDiscountPercent,
    appliedDiscountPercent: snapshot.appliedDiscountPercent,
    appliedDiscountType,
    packLine,
    outreachLine,
    totalPeriodCents: snapshot.totalPeriodCents,
    catalogSnapshot: snapshotCatalogEnvelope(),
    pricingSnapshot: snapshot,
  };
}

export type OutreachOnlyCommercialQuote = {
  planKey: null;
  billingIntervalMonths: BillingIntervalMonths;
  outreachAddonKey: OutreachAddonKey;
  billableAccountCount: number;
  termDiscountPercent: number;
  agencyDiscountPercent: number;
  appliedDiscountPercent: number;
  appliedDiscountType: DiscountType;
  packLine: QuoteLine;
  outreachLine: QuoteLine;
  totalPeriodCents: number;
  catalogSnapshot: ReturnType<typeof snapshotCatalogEnvelope>;
  pricingSnapshot: CommercialPricingSnapshot;
};

export function buildOutreachOnlyQuote(input: {
  outreachAddonKey: string;
  billingIntervalMonths: number;
}): OutreachOnlyCommercialQuote | { ok: false; error: string } {
  const outreachAddonKey = input.outreachAddonKey as OutreachAddonKey;
  if (!OUTREACH_ADDONS[outreachAddonKey]) {
    return { ok: false, error: "invalid_outreach" };
  }
  const billingIntervalMonths = Number(input.billingIntervalMonths);
  if (![1, 3, 6, 12].includes(billingIntervalMonths)) {
    return { ok: false, error: "invalid_billing_interval" };
  }
  const months = billingIntervalMonths as BillingIntervalMonths;
  const addon = OUTREACH_ADDONS[outreachAddonKey];
  const termDiscountPercent = { 1: 0, 3: 0.1, 6: 0.2, 12: 0.25 }[months];
  const monthlyDiscounted = Math.round(addon.baseMonthlyPriceCents * (1 - termDiscountPercent));
  const billingPeriodTotalCents = monthlyDiscounted * months;
  const outreachLine = buildQuoteLineFromSnapshot({
    lineKey: "outreach",
    label: addon.displayNameFr,
    baseMonthlyPriceCents: addon.baseMonthlyPriceCents,
    billingIntervalMonths: months,
    discountPercent: termDiscountPercent,
    discountType: termDiscountPercent > 0 ? "term" : "none",
    monthlyDiscountedPriceCents: monthlyDiscounted,
    billingPeriodTotalCents,
  });
  const pricingSnapshot = {
    version: `outreach-only:${outreachAddonKey}:${months}`,
    planKey: null,
    billingIntervalMonths: months,
    outreachAddonKey,
    packBaseMonthlyCents: 0,
    packFinalMonthlyCents: 0,
    packPeriodTotalCents: 0,
    outreachBaseMonthlyCents: addon.baseMonthlyPriceCents,
    outreachFinalMonthlyCents: monthlyDiscounted,
    outreachPeriodTotalCents: billingPeriodTotalCents,
    totalPeriodCents: billingPeriodTotalCents,
    billableAccountCount: 1,
    durationDiscountPercent: termDiscountPercent,
    volumeDiscountPercent: 0,
    appliedDiscountPercent: termDiscountPercent,
    appliedDiscountKind: termDiscountPercent > 0 ? "duration" as const : "none" as const,
  } as unknown as CommercialPricingSnapshot;

  return {
    planKey: null,
    billingIntervalMonths: months,
    outreachAddonKey,
    billableAccountCount: 1,
    termDiscountPercent,
    agencyDiscountPercent: 0,
    appliedDiscountPercent: termDiscountPercent,
    appliedDiscountType: termDiscountPercent > 0 ? "term" : "none",
    packLine: {
      lineKey: "pack",
      label: "Outreach seul",
      baseMonthlyPriceCents: 0,
      discountPercent: 0,
      discountType: "none",
      monthlyDiscountedPriceCents: 0,
      billingIntervalMonths: months,
      billingPeriodTotalCents: 0,
    },
    outreachLine,
    totalPeriodCents: billingPeriodTotalCents,
    catalogSnapshot: snapshotCatalogEnvelope(),
    pricingSnapshot,
  };
}

export function formatEurosFromCents(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function formatEurosFromCentsEn(cents: number) {
  return (cents / 100).toFixed(2);
}

export function renewalLabelFr(months: BillingIntervalMonths) {
  if (months === 1) return "tous les mois";
  if (months === 3) return "tous les 3 mois";
  if (months === 6) return "tous les 6 mois";
  return "tous les 12 mois";
}

export type { CommercialPricingSnapshot } from "./pricing-snapshot.ts";
