export type ClientCommercialPackageCode = "growth" | "pro" | "premium" | "internal_test" | string;

export function normalizeClientPackageCode(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/** Client-facing AI targeting gate: Growth disabled; Pro and Premium enabled. */
export function isClientAiTargetingEnabled(packageCode: string | null | undefined) {
  const normalized = normalizeClientPackageCode(packageCode);
  if (!normalized || normalized === "growth") return false;
  if (normalized === "pro" || normalized === "premium") return true;
  if (normalized === "internal_test") return false;
  return false;
}

export function clientAiTargetingUpgradeLabel(lang: "fr" | "en") {
  return lang === "fr"
    ? "Activer la Recherche avec l'Intelligence Artificielle"
    : "Activate AI-Powered Target Discovery";
}

export function clientAiTargetingButtonLabel(lang: "fr" | "en") {
  return lang === "fr" ? "Lancer la recherche avec l'IA" : "Launch AI search";
}

export function clientAiTargetingComingSoonMessage(lang: "fr" | "en") {
  return lang === "fr"
    ? "La recherche IA sera bientôt disponible. Votre formule inclut déjà cette option."
    : "AI search is coming soon. Your plan already includes this feature.";
}
