import type {
  ClientPublicAnalysis,
  ClientTargetingCriteria,
} from "./client-account-onboarding.ts";

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

export type PublicAnalysisUiState = "complete" | "partial" | "failed_retryable" | "not_found";

function localized(lang: ProfileAiUiLanguage, fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

export function hasConfirmablePublicAnalysis(analysis: ClientPublicAnalysis | null) {
  if (!analysis) return false;
  return Boolean(
    analysis.avatarAvailable
    || analysis.displayName
    || analysis.biography
    || analysis.followersCount != null
    || analysis.followingCount != null
    || analysis.postsCount != null
    || analysis.category
    || analysis.language
    || analysis.niche
    || analysis.probableAudience
    || analysis.businessDescription
    || analysis.themes.length
    || analysis.keywords.length,
  );
}

export function publicAnalysisUiState(analysis: ClientPublicAnalysis | null): PublicAnalysisUiState {
  if (!analysis) return "failed_retryable";
  if (analysis.lookupStatus === "not_found") return "not_found";
  if (["rate_limited", "unavailable", "provider_error"].includes(analysis.lookupStatus)) return "failed_retryable";
  const completePublicCore = analysis.lookupStatus === "found"
    && analysis.avatarAvailable
    && Boolean(analysis.displayName)
    && analysis.followersCount != null
    && Boolean(analysis.biography);
  return completePublicCore ? "complete" : "partial";
}

export function publicAnalysisStateCopy(lang: ProfileAiUiLanguage, state: PublicAnalysisUiState) {
  if (state === "not_found") {
    return localized(
      lang,
      "Profil public introuvable. Vérifie l'identifiant avant de poursuivre.",
      "Public profile not found. Check the username before continuing.",
    );
  }
  if (state === "failed_retryable") {
    return localized(
      lang,
      "L'analyse publique est temporairement indisponible. La session et les identifiants sont conservés : tu peux réanalyser sans recommencer.",
      "Public analysis is temporarily unavailable. The session and credentials are preserved: you can reanalyze without starting over.",
    );
  }
  if (state === "partial") {
    return localized(
      lang,
      "Analyse partielle : les données détectées sont affichées et les autres restent inconnues.",
      "Partial analysis: detected data is shown and the remaining fields stay unknown.",
    );
  }
  return localized(lang, "Données publiques détectées.", "Public data detected.");
}

export function profileTargetingLanguageLabel(lang: ProfileAiUiLanguage, value: string) {
  if (value === "fr") return localized(lang, "Français", "French");
  if (value === "en") return localized(lang, "Anglais", "English");
  return "";
}

export function confirmedProfileTargetingDraft(
  analysis: ClientPublicAnalysis | null,
): ClientTargetingCriteria {
  const language = analysis?.language === "fr" || analysis?.language === "en"
    ? analysis.language
    : "";
  const confirmedLocation = analysis?.sources.location === "user_confirmed"
    ? analysis.location ?? ""
    : "";
  return {
    idealCustomer: analysis?.probableAudience ?? "",
    geography: confirmedLocation,
    niche: analysis?.niche ?? "",
    businessDescription: analysis?.businessDescription ?? analysis?.biography ?? "",
    language,
    themes: analysis?.themes ?? [],
    keywords: analysis?.keywords ?? [],
  };
}

export function hydrateProfileTargetingDraft(
  analysis: ClientPublicAnalysis | null,
  storedDraft: ClientTargetingCriteria | null,
) {
  return storedDraft ?? confirmedProfileTargetingDraft(analysis);
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
