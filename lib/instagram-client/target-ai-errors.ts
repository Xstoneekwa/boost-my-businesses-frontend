import type { TargetAiErrorCode } from "./target-ai-config.ts";
import type { TargetAiLang } from "./target-ai-copy.ts";

export class TargetAiRequestError extends Error {
  code: TargetAiErrorCode;

  constructor(code: TargetAiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function targetAiErrorMessage(lang: TargetAiLang, code: TargetAiErrorCode) {
  const fr = lang === "fr";
  switch (code) {
    case "plan_not_allowed":
      return fr
        ? "La recherche IA n’est pas incluse dans votre formule actuelle."
        : "AI search is not included in your current plan.";
    case "target_ai_disabled":
      return fr
        ? "La recherche IA est temporairement indisponible."
        : "AI search is temporarily unavailable.";
    case "target_ai_provider_missing":
    case "target_ai_provider_error":
      return fr
        ? "La recherche IA est temporairement indisponible. Réessayez dans quelques instants."
        : "AI search is temporarily unavailable. Please try again shortly.";
    case "ownership_denied":
      return fr ? "Accès refusé à ce compte." : "You are not allowed to manage this account.";
    case "invalid_niche":
      return fr ? "Indiquez une niche ou un mot-clé valide." : "Enter a valid niche or keyword.";
    case "no_candidates_found":
      return fr
        ? "Aucun compte pertinent trouvé pour cette recherche. Essayez une niche plus précise ou une autre zone."
        : "No relevant accounts were found. Try a more specific niche or another area.";
    case "location_unavailable":
      return fr
        ? "La recherche de localisation est temporairement indisponible."
        : "Location search is temporarily unavailable.";
    default:
      return fr ? "La recherche IA n’a pas pu aboutir." : "AI search could not complete.";
  }
}

export function mapTargetAiApiError(lang: TargetAiLang, error: unknown, fallbackCode: TargetAiErrorCode = "target_ai_provider_error") {
  if (error instanceof TargetAiRequestError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: fallbackCode, message: error.message };
  }
  return { code: fallbackCode, message: targetAiErrorMessage(lang, fallbackCode) };
}
