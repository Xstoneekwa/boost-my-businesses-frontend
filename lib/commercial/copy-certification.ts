import { commercialCalendlyCta } from "./calendly-cta";
import { commercialCertifiedCopyKey, type CommercialOutreachGeneratedMessage } from "./outreach-contract";
import { validateCommercialOutreachMessage } from "./outreach-validation";

/** Technical examples only. Never persisted as prospects or counted as human decisions. */
export function certifiedCopyFixtures() {
  return (["en", "fr"] as const).flatMap(language => (["instagram", "email"] as const).flatMap(channel => (["A", "B"] as const).map(angle => {
    const fr = language === "fr";
    const businessName = fr ? "Atelier Lumière" : "Glow Studio";
    const city = fr ? "Lyon" : "Cape Town";
    const quote = fr ? "maquillage de mariée" : "bridal makeup";
    const facts = [
      { key: "business_name", value: businessName, source: "synthetic_fixture" },
      { key: "instagram_bio", value: fr ? "Maquillage de mariée à Lyon" : "Bridal makeup in Cape Town", source: "synthetic_fixture" },
      { key: "country_code", value: fr ? "FR" : "ZA", source: "synthetic_fixture" },
    ];
    const opening = fr ? `Bonjour ${businessName}, j'ai remarqué votre spécialisation en ${quote} à ${city}.`
      : `Hi ${businessName}, I noticed your ${quote} in ${city}.`;
    const opportunity = fr ? (angle === "A" ? "Votre travail pourrait gagner en visibilité auprès de personnes qui suivent déjà des entreprises similaires." : "Vos futurs clients sont peut-être déjà sur Instagram, à la recherche d'inspiration pour leur mariage.")
      : (angle === "A" ? "People following similar businesses could also discover your work." : "Your next customers may already be exploring similar businesses on Instagram.");
    const mechanism = fr ? `Boost My Businesses identifie les audiences Instagram pertinentes autour d'entreprises similaires et utilise des interactions ciblées pour attirer ces personnes vers votre profil, afin de ${angle === "A" ? "développer votre visibilité auprès de clients potentiels" : "vous aider à toucher des clients potentiels"}.`
      : `Boost My Businesses identifies relevant Instagram audiences around similar businesses and uses targeted interactions to bring those people to your profile, helping you ${angle === "A" ? "grow visibility among potential customers" : "reach potential customers"}.`;
    const cta = commercialCalendlyCta(language,channel).text;
    const emailContext = channel === "email" && !fr ? " The opportunity is to help those people discover your profile and explore what you offer, without assuming they are ready to book." : "";
    const body = [opening, opportunity + emailContext, mechanism, cta].join(channel === "email" ? "\n\n" : " ");
    const message: CommercialOutreachGeneratedMessage = {
      channel, angle, template_version: commercialCertifiedCopyKey(channel, angle, language),
      subject: channel === "email" ? (fr ? `Des audiences Instagram pour ${businessName}` : `Instagram audiences for ${businessName}`) : null,
      body, confidence: 1, personalization_summary: "FIXTURE — technical validation, not a real lead.",
      personalization_evidence: { key: "instagram_bio", quote }, facts_used: facts.map(({ key, value }) => ({ key, value })),
    };
    return { ...message, language, source: "FIXTURE" as const, liveSendEligible: false as const, approvedAt: null,
      businessName, city, verifiedFacts: facts,
      validation: validateCommercialOutreachMessage({ message, businessName, city, verifiedFacts: facts }) };
  })));
}
