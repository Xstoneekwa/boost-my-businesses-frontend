import type { CommercialPricingSnapshot } from "./pricing-snapshot.ts";

export type CommercialDiscountBreakdownLabels = {
  basePrice: string;
  durationDiscount: string;
  volumeDiscount: string;
  bestDiscount: string;
  noStacking: string;
  finalTotal: string;
  agencyMode: string;
};

export function commercialDiscountBreakdownLabels(lang: "fr" | "en"): CommercialDiscountBreakdownLabels {
  if (lang === "en") {
    return {
      basePrice: "Base price",
      durationDiscount: "Term discount",
      volumeDiscount: "Agency volume discount",
      bestDiscount: "Best discount applied",
      noStacking: "Term and Agency discounts do not stack.",
      finalTotal: "Final total",
      agencyMode: "Agency Mode",
    };
  }
  return {
    basePrice: "Prix de base",
    durationDiscount: "Remise durée",
    volumeDiscount: "Remise volume Agence",
    bestDiscount: "Meilleure remise retenue",
    noStacking: "Les remises durée et Agence ne se cumulent pas.",
    finalTotal: "Total final",
    agencyMode: "Mode Agence",
  };
}

export function formatDiscountPercentLabel(percent: number, lang: "fr" | "en") {
  const value = Math.round(percent * 100);
  return lang === "fr" ? `−${value} %` : `−${value}%`;
}

export function appliedDiscountKindLabel(kind: CommercialPricingSnapshot["appliedDiscountKind"], lang: "fr" | "en") {
  if (kind === "duration") return lang === "fr" ? "durée" : "term";
  if (kind === "agency_volume") return lang === "fr" ? "volume Agence" : "agency volume";
  return lang === "fr" ? "aucune" : "none";
}

export function eurosFromCents(cents: number, lang: "fr" | "en") {
  const amount = (cents / 100).toFixed(2);
  return lang === "fr" ? `${amount.replace(".", ",")} €` : `€${amount}`;
}
