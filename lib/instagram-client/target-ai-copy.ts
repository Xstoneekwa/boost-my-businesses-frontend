import type { AiTargetEligibilityReasonCode } from "./target-ai-eligibility.ts";

export type TargetAiLang = "fr" | "en";

export function targetAiCopy(lang: TargetAiLang) {
  const fr = lang === "fr";
  return {
    stepLabel: (step: number) => (fr ? `Étape ${step}/3` : `Step ${step}/3`),
    step1Title: fr ? "Choisissez votre niche" : "Choose your niche",
    step1Body: fr
      ? "Indiquez votre secteur ou un mot-clé métier pour trouver des comptes Instagram pertinents."
      : "Enter your business sector or a keyword to find relevant Instagram accounts.",
    nicheLabel: fr ? "Niche ou mot-clé" : "Niche or keyword",
    nichePlaceholder: fr ? "Ex. : coiffeur, restaurant italien, photographe mariage" : "e.g. hairdresser, Italian restaurant, wedding photographer",
    continue: fr ? "Continuer" : "Continue",
    step2Title: fr ? "Affinez la zone" : "Refine the area",
    step2Body: fr
      ? "Ajoutez une ville ou une région pour cibler les comptes les plus pertinents. Ce champ est optionnel."
      : "Add a city or region to focus on the most relevant accounts. This field is optional.",
    locationLabel: fr ? "Localisation (optionnelle)" : "Location (optional)",
    locationPlaceholder: fr ? "Rechercher une ville ou une région…" : "Search for a city or region…",
    locationEmpty: fr ? "Aucun résultat pour cette recherche." : "No results for this search.",
    back: fr ? "Retour" : "Back",
    launchSearch: fr ? "Lancer la recherche" : "Launch search",
    step3Title: fr ? "Confirmez vos comptes cibles" : "Confirm your target accounts",
    step3Body: fr
      ? "Retirez les comptes que vous ne souhaitez pas utiliser. Seuls les comptes éligibles pourront être validés."
      : "Remove accounts you do not want to use. Only eligible accounts can be validated.",
    loadingTitle: fr ? "Recherche en cours…" : "Searching…",
    loadingBody: fr
      ? "Nous analysons votre niche et vérifions les comptes proposés. Cela peut prendre jusqu’à deux minutes."
      : "We are analyzing your niche and verifying suggested accounts. This may take up to two minutes.",
    validate: fr ? "Valider la sélection" : "Validate selection",
    newSearch: fr ? "Nouvelle recherche" : "Start a new search",
    remove: fr ? "Retirer" : "Remove",
    openInstagram: fr ? "Ouvrir sur Instagram" : "Open on Instagram",
    eligible: fr ? "Éligible" : "Eligible",
    ineligible: fr ? "Non éligible" : "Not eligible",
    followers: fr ? "abonnés" : "followers",
    blockedValidation: fr
      ? "Retirez les comptes non éligibles avant de valider votre sélection."
      : "Remove ineligible accounts before validating your selection.",
    emptySelection: fr ? "Ajoutez au moins un compte éligible à votre sélection." : "Add at least one eligible account to your selection.",
    searchError: fr ? "La recherche IA n’a pas pu aboutir. Réessayez dans un instant." : "AI search could not complete. Please try again shortly.",
    validateError: fr ? "Impossible d’ajouter la sélection pour le moment." : "Could not add the selected accounts right now.",
    validateSuccess: (count: number) => fr
      ? `${count} compte(s) ajouté(s) à votre ciblage.`
      : `${count} account(s) added to your targeting.`,
    close: fr ? "Fermer" : "Close",
  };
}

export function targetAiEligibilityLabel(lang: TargetAiLang, reasonCode: AiTargetEligibilityReasonCode) {
  if (!reasonCode) return "";
  const fr = lang === "fr";
  switch (reasonCode) {
    case "low_followers":
      return fr ? "Moins de 500 abonnés" : "Fewer than 500 followers";
    case "verified":
      return fr ? "Compte certifié" : "Verified account";
    case "private":
      return fr ? "Compte privé" : "Private account";
    case "not_found":
      return fr ? "Compte introuvable" : "Account not found";
    case "too_many_followers":
      return fr ? "Plus de 50 000 abonnés" : "More than 50,000 followers";
    case "pending_verification":
      return fr ? "Vérification en cours" : "Verification pending";
    default:
      return fr ? "Non conforme à nos critères" : "Does not meet our criteria";
  }
}
