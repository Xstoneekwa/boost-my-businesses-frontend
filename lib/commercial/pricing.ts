import {
  COMMERCIAL_PLANS,
  OUTREACH_ADDONS,
  TERM_DISCOUNT_PERCENT,
  type BillingIntervalMonths,
  type DiscountType,
  type OutreachAddonKey,
  type PlanKey,
  catalogSnapshot,
  isBillingIntervalMonths,
  isOutreachAddonKey,
  isPlanKey,
} from "./catalog.ts";
import { agencyDiscountPercentForBillableCount } from "./agency.ts";

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
  catalogSnapshot: ReturnType<typeof catalogSnapshot>;
};

function roundCents(value: number) {
  return Math.round(value);
}

function resolveDiscount(termPercent: number, agencyPercent: number) {
  if (agencyPercent > termPercent) {
    return { percent: agencyPercent, type: "agency" as const };
  }
  if (termPercent > 0) {
    return { percent: termPercent, type: "term" as const };
  }
  return { percent: 0, type: "none" as const };
}

function buildQuoteLine(input: {
  lineKey: "pack" | "outreach";
  label: string;
  baseMonthlyPriceCents: number;
  billingIntervalMonths: BillingIntervalMonths;
  discountPercent: number;
  discountType: DiscountType;
}): QuoteLine {
  const monthlyDiscountedPriceCents = roundCents(input.baseMonthlyPriceCents * (1 - input.discountPercent));
  const billingPeriodTotalCents = monthlyDiscountedPriceCents * input.billingIntervalMonths;
  return {
    lineKey: input.lineKey,
    label: input.label,
    baseMonthlyPriceCents: input.baseMonthlyPriceCents,
    discountPercent: input.discountPercent,
    discountType: input.discountType,
    monthlyDiscountedPriceCents,
    billingIntervalMonths: input.billingIntervalMonths,
    billingPeriodTotalCents,
  };
}

export function buildCommercialQuote(input: {
  planKey: string;
  billingIntervalMonths: number;
  outreachAddonKey?: string | null;
  billableAccountCount: number;
}): CommercialQuote | { ok: false; error: string } {
  if (!isPlanKey(input.planKey)) {
    return { ok: false, error: "invalid_plan_key" };
  }
  if (!isBillingIntervalMonths(input.billingIntervalMonths)) {
    return { ok: false, error: "invalid_billing_interval" };
  }

  const outreachAddonKey: OutreachAddonKey | null = input.outreachAddonKey?.trim()
    ? (isOutreachAddonKey(input.outreachAddonKey.trim()) ? input.outreachAddonKey.trim() as OutreachAddonKey : null)
    : null;
  if (input.outreachAddonKey?.trim() && !outreachAddonKey) {
    return { ok: false, error: "invalid_outreach_addon" };
  }

  const plan = COMMERCIAL_PLANS[input.planKey];
  const termDiscountPercent = TERM_DISCOUNT_PERCENT[input.billingIntervalMonths];
  const agencyDiscountPercent = agencyDiscountPercentForBillableCount(input.billableAccountCount);
  const discount = resolveDiscount(termDiscountPercent, agencyDiscountPercent);

  const packLine = buildQuoteLine({
    lineKey: "pack",
    label: plan.displayName,
    baseMonthlyPriceCents: plan.baseMonthlyPriceCents,
    billingIntervalMonths: input.billingIntervalMonths,
    discountPercent: discount.percent,
    discountType: discount.type,
  });

  const outreachLine = outreachAddonKey
    ? buildQuoteLine({
      lineKey: "outreach",
      label: OUTREACH_ADDONS[outreachAddonKey as OutreachAddonKey].displayNameFr,
      baseMonthlyPriceCents: OUTREACH_ADDONS[outreachAddonKey as OutreachAddonKey].baseMonthlyPriceCents,
      billingIntervalMonths: input.billingIntervalMonths,
      discountPercent: discount.percent,
      discountType: discount.type,
    })
    : null;

  const totalPeriodCents = packLine.billingPeriodTotalCents + (outreachLine?.billingPeriodTotalCents ?? 0);

  return {
    planKey: input.planKey,
    billingIntervalMonths: input.billingIntervalMonths,
    outreachAddonKey,
    billableAccountCount: Math.max(1, input.billableAccountCount),
    termDiscountPercent,
    agencyDiscountPercent,
    appliedDiscountPercent: discount.percent,
    appliedDiscountType: discount.type,
    packLine,
    outreachLine,
    totalPeriodCents,
    catalogSnapshot: catalogSnapshot(),
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
