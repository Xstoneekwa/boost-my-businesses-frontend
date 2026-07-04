import { COMMERCIAL_PLANS, OUTREACH_ADDONS, type PlanKey } from "../catalog.ts";
import type { ClientBillingLang } from "./client-billing-types.ts";

type EntitlementLike = {
  planKey: string | null;
  commercialPackageCode: string | null;
  outreachAddonKey: string | null;
  billingIntervalMonths: number | null;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function formatMoney(amountMinor: number, currency: string, lang: ClientBillingLang) {
  const code = currency.toUpperCase() || "EUR";
  const amount = amountMinor / 100;
  try {
    return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", {
      style: "currency",
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

function resolveCanonicalServiceName(input: {
  entitlement: EntitlementLike | null;
  commercialMode: string | null;
  packageLabel: string;
  lang: ClientBillingLang;
}) {
  const mode = readString(input.commercialMode).toLowerCase();
  const outreachKey = readString(input.entitlement?.outreachAddonKey).toLowerCase();
  const outreachDef = outreachKey && outreachKey in OUTREACH_ADDONS
    ? OUTREACH_ADDONS[outreachKey as keyof typeof OUTREACH_ADDONS]
    : null;

  if (mode === "outreach_only" || (!readString(input.entitlement?.planKey || input.entitlement?.commercialPackageCode) && outreachDef)) {
    const outreachName = outreachDef
      ? (input.lang === "fr" ? outreachDef.displayNameFr : outreachDef.displayNameEn)
      : (input.lang === "fr" ? "Standard" : "Standard");
    const shortName = outreachName.replace(/^Outreach\s+/i, "");
    return input.lang === "fr"
      ? `Instagram Outreach — ${shortName}`
      : `Instagram Outreach — ${shortName}`;
  }

  const planKey = readString(input.entitlement?.planKey || input.entitlement?.commercialPackageCode).toLowerCase();
  const planName = planKey && planKey in COMMERCIAL_PLANS
    ? COMMERCIAL_PLANS[planKey as PlanKey].displayName
    : readString(input.packageLabel);
  if (planName) {
    return `Boost AI — ${planName}`;
  }

  return input.lang === "fr" ? "Abonnement" : "Subscription";
}

function cadenceSuffix(months: number, lang: ClientBillingLang) {
  if (months <= 1) return lang === "fr" ? "/ mois" : "/ month";
  if (months === 12) return lang === "fr" ? "/ an" : "/ year";
  if (months === 3) return lang === "fr" ? "tous les 3 mois" : "every 3 months";
  if (months === 6) return lang === "fr" ? "tous les 6 mois" : "every 6 months";
  return lang === "fr" ? `tous les ${months} mois` : `every ${months} months`;
}

function usesSlashCadence(months: number) {
  return months <= 1 || months === 12;
}

export function buildLocalizedInvoiceServiceLabel(input: {
  entitlement: EntitlementLike | null;
  commercialMode: string | null;
  packageLabel: string;
  amountMinor: number;
  currency: string;
  quantity: number;
  lang: ClientBillingLang;
}) {
  const quantity = input.quantity > 0 ? input.quantity : 1;
  const months = Number(input.entitlement?.billingIntervalMonths) || 1;
  const serviceName = resolveCanonicalServiceName(input);
  const amountLabel = formatMoney(input.amountMinor, input.currency, input.lang);
  const cadence = cadenceSuffix(months, input.lang);
  if (usesSlashCadence(months)) {
    return `${quantity} × ${serviceName} · ${amountLabel} ${cadence}`;
  }
  return `${quantity} × ${serviceName} · ${amountLabel} ${cadence}`;
}

export function stripeInvoiceLineLooksRaw(description: string) {
  const normalized = description.toLowerCase();
  return /\bat\b/.test(normalized)
    || /\bevery\b/.test(normalized)
    || /\/\s*month/.test(normalized)
    || /\/\s*year/.test(normalized)
    || /\(at\s/.test(normalized);
}
