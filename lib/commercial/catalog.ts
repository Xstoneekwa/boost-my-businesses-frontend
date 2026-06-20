export type PlanKey = "growth" | "pro" | "premium";
export type OutreachAddonKey = "outreach_standard" | "outreach_ai";
export type BillingIntervalMonths = 1 | 3 | 6 | 12;
export type DiscountType = "none" | "term" | "agency";
export type CheckoutFlowType = "first_purchase" | "additional_account";
export type CheckoutSessionStatus = "checkout_pending" | "checkout_activated_test" | "checkout_cancelled";
export type EntitlementStatus = "entitlement_reserved" | "entitlement_consumed" | "entitlement_cancelled";

export type CommercialPlanDefinition = {
  planKey: PlanKey;
  displayName: string;
  baseMonthlyPriceCents: number;
  commercialPackageCode: PlanKey;
  growthEstimateLabelFr: string;
  growthEstimateLabelEn: string;
  outreachEligible: true;
};

export type OutreachAddonDefinition = {
  addonKey: OutreachAddonKey;
  displayNameFr: string;
  displayNameEn: string;
  baseMonthlyPriceCents: number;
  outreachVariant: "client_list" | "ai_list";
  backendAddonCode: "extra_outreach_volume";
};

export const COMMERCIAL_CATALOG_VERSION = "2026-06-15.1";

export const COMMERCIAL_PLANS: Record<PlanKey, CommercialPlanDefinition> = {
  growth: {
    planKey: "growth",
    displayName: "Growth",
    baseMonthlyPriceCents: 14700,
    commercialPackageCode: "growth",
    growthEstimateLabelFr: "~200–350 abonnés",
    growthEstimateLabelEn: "~200–350 followers",
    outreachEligible: true,
  },
  pro: {
    planKey: "pro",
    displayName: "Pro",
    baseMonthlyPriceCents: 19700,
    commercialPackageCode: "pro",
    growthEstimateLabelFr: "~300–500 abonnés",
    growthEstimateLabelEn: "~300–500 followers",
    outreachEligible: true,
  },
  premium: {
    planKey: "premium",
    displayName: "Premium",
    baseMonthlyPriceCents: 24700,
    commercialPackageCode: "premium",
    growthEstimateLabelFr: "~300–800 abonnés",
    growthEstimateLabelEn: "~300–800 followers",
    outreachEligible: true,
  },
};

export const OUTREACH_ADDONS: Record<OutreachAddonKey, OutreachAddonDefinition> = {
  outreach_standard: {
    addonKey: "outreach_standard",
    displayNameFr: "Outreach Standard",
    displayNameEn: "Outreach Standard",
    baseMonthlyPriceCents: 8900,
    outreachVariant: "client_list",
    backendAddonCode: "extra_outreach_volume",
  },
  outreach_ai: {
    addonKey: "outreach_ai",
    displayNameFr: "Outreach IA",
    displayNameEn: "Outreach AI",
    baseMonthlyPriceCents: 14900,
    outreachVariant: "ai_list",
    backendAddonCode: "extra_outreach_volume",
  },
};

export const TERM_DISCOUNT_PERCENT: Record<BillingIntervalMonths, number> = {
  1: 0,
  3: 0.1,
  6: 0.2,
  12: 0.25,
};

export const AGENCY_DISCOUNT_TIERS: Array<{ minAccounts: number; maxAccounts: number | null; percent: number }> = [
  { minAccounts: 1, maxAccounts: 5, percent: 0 },
  { minAccounts: 6, maxAccounts: 10, percent: 0.14 },
  { minAccounts: 11, maxAccounts: 25, percent: 0.22 },
  { minAccounts: 26, maxAccounts: 40, percent: 0.32 },
  { minAccounts: 41, maxAccounts: 50, percent: 0.4 },
  { minAccounts: 51, maxAccounts: null, percent: 0.45 },
];

export function isPlanKey(value: string): value is PlanKey {
  return value === "growth" || value === "pro" || value === "premium";
}

export function isOutreachAddonKey(value: string): value is OutreachAddonKey {
  return value === "outreach_standard" || value === "outreach_ai";
}

export function isBillingIntervalMonths(value: number): value is BillingIntervalMonths {
  return value === 1 || value === 3 || value === 6 || value === 12;
}

export function catalogSnapshot() {
  return {
    version: COMMERCIAL_CATALOG_VERSION,
    plans: COMMERCIAL_PLANS,
    outreachAddons: OUTREACH_ADDONS,
    termDiscountPercent: TERM_DISCOUNT_PERCENT,
    agencyDiscountTiers: AGENCY_DISCOUNT_TIERS,
  };
}
