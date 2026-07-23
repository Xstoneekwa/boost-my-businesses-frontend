export type ClientTargetDisplayLang = "fr" | "en";

export type ClientTargetPerformanceStatus =
  | "pending"
  | "insufficient_data"
  | "not_applicable"
  | "bad"
  | "avg"
  | "good";

const performanceLabels: Record<ClientTargetDisplayLang, Record<ClientTargetPerformanceStatus, string>> = {
  fr: {
    pending: "En attente de mesure",
    insufficient_data: "Données insuffisantes",
    not_applicable: "Non applicable",
    bad: "Faible",
    avg: "Moyenne",
    good: "Bonne",
  },
  en: {
    pending: "Pending measurement",
    insufficient_data: "Insufficient data",
    not_applicable: "Not applicable",
    bad: "Low",
    avg: "Average",
    good: "Good",
  },
};

export function formatClientTargetSent(
  value: number | null | undefined,
  lang: ClientTargetDisplayLang,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(value);
}

export function clientTargetPerformanceLabel(
  status: ClientTargetPerformanceStatus,
  lang: ClientTargetDisplayLang,
) {
  return performanceLabels[lang][status];
}

export function clientTargetPerformanceHelp(lang: ClientTargetDisplayLang) {
  return lang === "fr"
    ? "La performance devient évaluable après 100 follows envoyés depuis cette cible."
    : "Performance becomes measurable after 100 follows sent from this target.";
}
