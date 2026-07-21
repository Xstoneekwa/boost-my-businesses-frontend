export type ProfileAiUiLanguage = "fr" | "en";
export type ProfileAiUiStatus = "not_started" | "running" | "completed" | "failed_retryable";
export type ProfileAiUiSource = "ai_suggested" | "user_confirmed" | "unknown" | undefined;
export type ProfileAiUiQualityStatus = "valid" | "insufficient" | "empty_valid" | "absent" | "rejected" | undefined;
export type ProfileAiUiField =
  | "suggestedCategory"
  | "niche"
  | "probableAudience"
  | "themes"
  | "businessDescription"
  | "keywords"
  | "exclusions";

function localized(lang: ProfileAiUiLanguage, fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

export function profileAiFieldLabel(input: {
  lang: ProfileAiUiLanguage;
  status: ProfileAiUiStatus;
  source: ProfileAiUiSource;
  field: ProfileAiUiField;
  qualityStatus?: ProfileAiUiQualityStatus;
  edited: boolean;
}) {
  if (input.status === "running") return localized(input.lang, "Analyse en cours", "Analysis in progress");
  if (input.edited || input.source === "user_confirmed") {
    return localized(input.lang, "Confirmé par vous", "Confirmed by you");
  }
  if (input.status === "failed_retryable") {
    return localized(input.lang, "À relancer ou compléter manuellement", "Rerun or complete manually");
  }
  if (input.status === "completed" && input.qualityStatus && input.qualityStatus !== "valid") {
    return input.field === "exclusions" && input.qualityStatus === "empty_valid"
      ? localized(input.lang, "Aucune exclusion suggérée", "No exclusions suggested")
      : localized(input.lang, "Aucune suggestion fiable", "No reliable suggestion");
  }
  if (input.source === "ai_suggested" || input.status === "completed") {
    return localized(input.lang, "Suggéré par l'analyse", "Suggested by the analysis");
  }
  return localized(input.lang, "À analyser", "To analyze");
}

export function profileAiEmptyValueCopy(input: {
  lang: ProfileAiUiLanguage;
  status: ProfileAiUiStatus;
  field: ProfileAiUiField;
  qualityStatus?: ProfileAiUiQualityStatus;
}) {
  if (input.status === "completed") {
    return input.field === "exclusions"
      ? localized(input.lang, "Aucune exclusion suggérée", "No exclusions suggested")
      : localized(input.lang, "Aucune suggestion fiable", "No reliable suggestion");
  }
  if (input.status === "running") return localized(input.lang, "Analyse en cours", "Analysis in progress");
  if (input.status === "failed_retryable") return localized(input.lang, "Relancer ou compléter manuellement", "Rerun or complete manually");
  return localized(input.lang, "À analyser", "To analyze");
}
