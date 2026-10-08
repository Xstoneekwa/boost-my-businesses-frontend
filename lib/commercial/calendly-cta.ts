import { commercialDemoBookingUrl } from "./booking-config";
import type { CommercialOutreachChannel } from "./outreach-contract";
import { resolveCommercialAudienceEvidence, type AudienceContext } from "./audience-evidence";

/** Application-owned copy. Never supplied to the model as generated content. */
export function commercialCalendlyCta(language: "en" | "fr", channel: CommercialOutreachChannel, context?: AudienceContext) {
  const url = commercialDemoBookingUrl();
  const evidence = resolveCommercialAudienceEvidence(context);
  const known = evidence.mode === "KNOWN_AUDIENCES";
  const version = `CALENDLY_CTA_${known ? "KNOWN_AUDIENCES" : "DISCOVERY"}_${language.toUpperCase()}_${channel === "instagram" ? "IG" : "EMAIL"}_V1`;
  const invitation = language === "fr"
    ? known
      ? "Si vous le souhaitez, vous pouvez réserver une courte démonstration ici. Je vous montrerai quelles audiences Instagram nous ciblerions pour votre activité :"
      : "Si vous le souhaitez, vous pouvez réserver une courte démonstration ici. Je vous montrerai comment Boost My Businesses identifierait et ciblerait les audiences Instagram les plus pertinentes pour votre activité :"
    : known
      ? "If you'd like, you can book a short demo here and I'll show you which Instagram audiences we'd target for your business:"
      : "If you'd like, you can book a short demo here and I'll show you how Boost My Businesses would identify and target the right Instagram audiences for your business:";
  return { version, url, text: `${invitation}\n${url}`, mode: evidence.mode, evidence };
}

/** Inspect all model-authored fields, including subject. Booking setup observations
 * are allowed; invitations to schedule, URLs and requests for a reply are not. */
export function hasModelBookingCta(value: string) {
  const text = value.normalize("NFKC").replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
  return /https?:|www\.|calendly|\b[\w-]+\.(?:com|co|io|fr|net|org)\b/i.test(text)
    || /\b(?:book|schedule|reserve|arrange|set up|join)\b[^.!?]{0,70}\b(?:demo|call|meeting|appointment|time|slot)\b/i.test(text)
    || /(?:réserv|planifi|programm|organis|pren(?:ez|dre)|fix)[^.!?]{0,70}(?:démo|démonstration|appel|rendez-vous|créneau)/i.test(text)
    || /(?:would you like|let'?s|can we|shall we|click|follow this link|reply to|contact me|souhaitez-vous|cliquez|répondez)[^.!?]{0,80}(?:demo|call|meet|link|book|discuss|démo|appel|lien|réserv|discut)/i.test(text);
}

export function composeCommercialCalendlyBody(aiBody: string, language: "en" | "fr", channel: CommercialOutreachChannel, context?: AudienceContext) {
  if (hasModelBookingCta(aiBody)) throw new Error("DUPLICATE_BOOKING_CTA_GUARD");
  const cta = commercialCalendlyCta(language, channel, context);
  return { body: `${aiBody.trim()}\n\n${cta.text}`, ctaVersion: cta.version };
}

/** Final V5 copy must contain the exact deterministic suffix for its CURRENT
 * evidence, not an AI-chosen mode or a caller-supplied facts_used assertion. */
export function audienceClaimGuard(body: string, language: "en" | "fr", channel: CommercialOutreachChannel, context?: AudienceContext) {
  const cta = commercialCalendlyCta(language, channel, context);
  const knownClaim = /which Instagram audiences|(?:quelles audiences Instagram|les audiences Instagram que nous ciblerions)/i.test(body);
  if (body.endsWith(cta.text) && !(knownClaim && cta.mode === "DISCOVERY_EXPLANATION"))
    return { ok: true, codes: [] as string[], mode: cta.mode };
  return { ok: false, mode: cta.mode, codes: [
    ...(knownClaim && cta.mode === "DISCOVERY_EXPLANATION" ? ["AUDIENCE_CLAIM_SUPPORTED"] : []),
    "DETERMINISTIC_CTA_MODE_MISMATCH",
  ] };
}
