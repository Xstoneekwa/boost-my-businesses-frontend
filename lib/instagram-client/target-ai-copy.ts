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
    locationSelectionRequired: fr
      ? "Sélectionnez une localisation dans la liste pour lancer la recherche."
      : "Select a location from the list to launch the search.",
    back: fr ? "Retour" : "Back",
    launchSearch: fr ? "Lancer la recherche" : "Launch search",
    step3Title: fr ? "Confirmez vos comptes cibles" : "Confirm your target accounts",
    step3Body: fr
      ? "Consultez les comptes trouvés pour votre campagne. Seuls les comptes éligibles seront ajoutés à votre ciblage."
      : "Review the accounts found for your campaign. Only eligible accounts will be added to your targeting.",
    loadingTitle: fr ? "Recherche en cours…" : "Searching…",
    loadingBody: fr
      ? "Nous analysons des profils Instagram pertinents pour votre campagne. Les premiers résultats arrivent dans quelques secondes."
      : "We are analyzing relevant Instagram profiles for your campaign. First results arrive in a few seconds.",
    validate: fr ? "Valider la sélection" : "Validate selection",
    enriching: fr ? "Analyse des profils…" : "Analyzing profiles…",
    partialValidation: fr
      ? "Certains profils ne respectent pas nos critères et n’ont pas été ajoutés."
      : "Some profiles did not meet our criteria and were not added.",
    newSearch: fr ? "Nouvelle recherche" : "Start a new search",
    remove: fr ? "Retirer" : "Remove",
    openInstagram: fr ? "Ouvrir sur Instagram" : "Open on Instagram",
    eligible: fr ? "Éligible" : "Eligible",
    ineligible: fr ? "Non éligible" : "Not eligible",
    followers: fr ? "abonnés" : "followers",
    ineligibleHint: fr
      ? "Les comptes non éligibles restent visibles pour information mais ne seront pas ajoutés."
      : "Ineligible accounts remain visible for reference but will not be added.",
    blockedValidation: fr
      ? "Les comptes non éligibles ne seront pas ajoutés. Ajoutez au moins un compte éligible pour continuer."
      : "Ineligible accounts will not be added. Add at least one eligible account to continue.",
    emptySelection: fr ? "Ajoutez au moins un compte à votre sélection." : "Add at least one account to your selection.",
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
      return fr ? "Trop peu d’abonnés" : "Too few followers";
    case "verified":
      return fr ? "Compte certifié" : "Verified account";
    case "private":
      return fr ? "Compte privé" : "Private account";
    case "not_found":
    case "unavailable":
      return fr ? "Profil indisponible" : "Profile unavailable";
    case "too_many_followers":
      return fr ? "Plus de 50 000 abonnés" : "More than 50,000 followers";
    case "out_of_target":
      return fr ? "Hors ciblage" : "Outside targeting";
    case "out_of_location":
      return fr ? "Hors localisation" : "Outside location";
    case "not_relevant":
      return fr ? "Profil non pertinent" : "Not relevant profile";
    case "pending_verification":
      return fr ? "Analyse en cours" : "Analysis in progress";
    case "rejected":
      return fr ? "Profil non pertinent" : "Not relevant profile";
    default:
      return fr ? "Hors critères" : "Outside criteria";
  }
}
