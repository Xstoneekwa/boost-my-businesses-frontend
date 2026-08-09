/** Consume the server-projected catalogue capability; never infer it from a package name. */
export function isClientAiTargetingEnabled(catalogueCapability: boolean | null | undefined) {
  return catalogueCapability === true;
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
