import {
  isBillingIntervalMonths,
  isOutreachAddonKey,
  isPlanKey,
  type BillingIntervalMonths,
  type OutreachAddonKey,
  type PlanKey,
} from "./catalog.ts";
import type { CommercialMode } from "./stripe/stripe-per-entitlement-billing.ts";

export type ResolvedPublicCheckoutSelection =
  | {
    ok: true;
    commercialMode: "full_cycle";
    planKey: PlanKey;
    billingIntervalMonths: BillingIntervalMonths;
    outreachAddonKey: OutreachAddonKey | null;
  }
  | {
    ok: true;
    commercialMode: "outreach_only";
    planKey: null;
    billingIntervalMonths: BillingIntervalMonths;
    outreachAddonKey: OutreachAddonKey;
  }
  | {
    ok: false;
    code: string;
    messageFr: string;
    messageEn: string;
  };

const PRICING_PATH = "/instagram-growth#pricing";

function parseMonths(raw: string): BillingIntervalMonths | null {
  const parsed = Number(raw || "1");
  return isBillingIntervalMonths(parsed) ? parsed : null;
}

function invalidSelection(code: string, messageFr: string, messageEn: string): ResolvedPublicCheckoutSelection {
  return { ok: false, code, messageFr, messageEn };
}

export function resolvePublicCheckoutSelection(input: {
  plan?: string | null;
  months?: string | number | null;
  outreach?: string | null;
  commercialMode?: string | null;
}): ResolvedPublicCheckoutSelection {
  const planRaw = typeof input.plan === "string" ? input.plan.trim() : "";
  const outreachRaw = typeof input.outreach === "string" ? input.outreach.trim() : "";
  const commercialModeRaw = typeof input.commercialMode === "string" ? input.commercialMode.trim() : "";
  const monthsRaw = input.months == null ? "" : String(input.months).trim();

  const explicitMode = commercialModeRaw === "outreach_only" || commercialModeRaw === "full_cycle"
    ? commercialModeRaw as CommercialMode
    : null;
  const planKey = planRaw && isPlanKey(planRaw) ? planRaw : planRaw ? null : null;
  const outreachAddonKey = outreachRaw && isOutreachAddonKey(outreachRaw) ? outreachRaw : outreachRaw ? null : null;
  const billingIntervalMonths = parseMonths(monthsRaw);

  if (planRaw && !isPlanKey(planRaw)) {
    return invalidSelection(
      "invalid_plan",
      "Offre invalide. Retournez à la page tarifs pour choisir un pack.",
      "Invalid plan selection. Return to pricing to choose a plan.",
    );
  }
  if (outreachRaw && !isOutreachAddonKey(outreachRaw)) {
    return invalidSelection(
      "invalid_outreach",
      "Option Outreach invalide. Retournez à la page tarifs pour choisir une offre.",
      "Invalid outreach selection. Return to pricing to choose an offer.",
    );
  }
  if (commercialModeRaw && commercialModeRaw !== "full_cycle" && commercialModeRaw !== "outreach_only") {
    return invalidSelection(
      "invalid_commercial_mode",
      "Sélection commerciale invalide. Retournez à la page tarifs.",
      "Invalid commercial selection. Return to pricing.",
    );
  }
  if (!billingIntervalMonths) {
    return invalidSelection(
      "invalid_billing_interval",
      "Durée de facturation invalide. Retournez à la page tarifs.",
      "Invalid billing term. Return to pricing.",
    );
  }

  const inferredMode = explicitMode
    ?? (planKey ? "full_cycle" as const : outreachAddonKey ? "outreach_only" as const : null);

  if (explicitMode === "outreach_only" && planKey) {
    return invalidSelection(
      "outreach_only_package_forbidden",
      "Outreach seul ne peut pas inclure de pack Boost AI. Retournez à la page tarifs.",
      "Outreach-only cannot include a Boost AI package. Return to pricing.",
    );
  }
  if (explicitMode === "full_cycle" && !planKey) {
    return invalidSelection(
      "full_cycle_package_required",
      "Choisissez un pack Boost AI sur la page tarifs avant de continuer.",
      "Choose a Boost AI plan on pricing before continuing.",
    );
  }
  if (!inferredMode) {
    return invalidSelection(
      "selection_incomplete",
      "Sélection incomplète. Retournez à la page tarifs pour choisir une offre.",
      "Incomplete selection. Return to pricing to choose an offer.",
    );
  }

  if (inferredMode === "outreach_only") {
    if (!outreachAddonKey) {
      return invalidSelection(
        "outreach_only_outreach_required",
        "Choisissez une option Outreach sur la page tarifs avant de continuer.",
        "Choose an Outreach option on pricing before continuing.",
      );
    }
    return {
      ok: true,
      commercialMode: "outreach_only",
      planKey: null,
      billingIntervalMonths,
      outreachAddonKey,
    };
  }

  if (!planKey) {
    return invalidSelection(
      "full_cycle_package_required",
      "Choisissez un pack Boost AI sur la page tarifs avant de continuer.",
      "Choose a Boost AI plan on pricing before continuing.",
    );
  }

  return {
    ok: true,
    commercialMode: "full_cycle",
    planKey,
    billingIntervalMonths,
    outreachAddonKey,
  };
}

export function publicCheckoutPricingPath() {
  return PRICING_PATH;
}

export type PublicPricingOfferKey =
  | "growth"
  | "pro"
  | "premium"
  | "outreach_standard"
  | "outreach_ai";

export const PUBLIC_PRICING_OFFER_KEYS: PublicPricingOfferKey[] = [
  "growth",
  "pro",
  "premium",
  "outreach_standard",
  "outreach_ai",
];

export function buildPublicPricingCheckoutHref(
  offer: PublicPricingOfferKey,
  months: BillingIntervalMonths = 1,
): string {
  const monthsParam = `months=${months}`;
  if (offer === "growth") return `/instagram-growth/checkout?plan=growth&${monthsParam}`;
  if (offer === "pro") return `/instagram-growth/checkout?plan=pro&${monthsParam}`;
  if (offer === "premium") return `/instagram-growth/checkout?plan=premium&${monthsParam}`;
  if (offer === "outreach_standard") {
    return `/instagram-growth/checkout?commercial_mode=outreach_only&outreach=outreach_standard&${monthsParam}`;
  }
  return `/instagram-growth/checkout?commercial_mode=outreach_only&outreach=outreach_ai&${monthsParam}`;
}
