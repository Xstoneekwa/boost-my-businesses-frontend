import type { CommercialOutreachAngle, CommercialOutreachChannel, CommercialOutreachFact } from "./outreach-contract";

export const OUTREACH_QUALITY_VERSION = "commercial_outreach_message_quality_v3";
export const AUDIENCE_CTA = "Would you like me to show you which Instagram audiences I'd target for your business?";

function clean(value: string) {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

export function hasUnresolvedOutreachPlaceholder(value: string) {
  const normalized = clean(value).replace(/&lt;|&#60;/gi, "<").replace(/&gt;|&#62;/gi, ">");
  // Bracketed substitutions have no valid use in this short plain-text copy.
  // Also reject unmatched braces/brackets rather than let malformed tokens leak.
  return /[\[\]{}<>]|\b(?:T[ _.-]?B[ _.-]?D|TO[ _.-]?DO|TBC|FIXME|PLACE[ _-]?HOLDER|INSERT[_ -]+(?:NAME|TEXT|COMPANY)|YOUR[_ -]+(?:NAME|COMPANY|BUSINESS[_ -]+NAME)|FIRST[_ -]+NAME)\b|%[A-Z_]+%|\$\w+|\bX{3,}\b/i.test(normalized);
}

export function commercialOutreachGreeting(input: { businessName: string; city?: string | null; verifiedFacts?: CommercialOutreachFact[] }) {
  // Never infer a person's first name from the business label, handle or bio.
  const verifiedFirst = input.verifiedFacts?.find((f) => f.key === "verified_contact_first_name" && f.source === "owner_verified_contact");
  if (verifiedFirst && /^[\p{L}][\p{L}'’-]{1,24}$/u.test(clean(verifiedFirst.value)) && !hasUnresolvedOutreachPlaceholder(verifiedFirst.value)) {
    const name = clean(verifiedFirst.value);
    return { display_name_for_greeting: name, greeting: `Hi ${name},`, source: "verified_first_name" as const };
  }
  let name = clean(input.businessName);
  if (hasUnresolvedOutreachPlaceholder(name) || /[@_\d]|https?:|www\./i.test(name)) name = "";
  // Keep a short brand before explicit descriptive separators, not a guessed name.
  name = name.split(/\s*[|•]\s*|\s+[–—]\s+/)[0].trim();
  const cities = [...new Set([input.city, "Cape Town", "Johannesburg", "Pretoria", "Durban"].filter((v): v is string => Boolean(v)))];
  for (const city of cities) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    name = name.replace(new RegExp(`(?:\\s*[-,]\\s*|\\s+(?:in\\s+|based\\s+in\\s+)?)${escaped}$`, "i"), "").trim();
  }
  const words = name.split(/\s+/);
  const genericOnly = /^(?:(?:best|bridal|wedding|professional|pro|luxury|local|based|hair|make[ -]?up|artist|artistry|stylist|salon|studio|beauty|lash|nail|aesthetic|clinic|med|spa|and|&|in)\s*)+$/i.test(name);
  if (!name || name.length > 32 || words.length > 4 || words.every((word) => word.length === 1) || genericOnly || !/^[\p{L}][\p{L}\p{M} &'’.-]*$/u.test(name)) {
    return { display_name_for_greeting: null, greeting: "Hi there,", source: "fallback" as const };
  }
  return { display_name_for_greeting: name, greeting: `Hi ${name},`, source: "short_business_name" as const };
}

export function outreachCopyInstructions(channel: CommercialOutreachChannel, angle: CommercialOutreachAngle) {
  return [
    "Never emit unresolved placeholders, bracketed tokens, Your Name, TODO or TBD. Omit unavailable information instead.",
    "Write the observation in everyday language. Never expose field labels or CRM taxonomy such as subsegment, qualification score or fact ledger. Do not praise expertise, vibrancy, engagement or performance without evidence. Preserve a specific verified service/bio/booking observation when available; city-only is a fallback for sparse facts.",
    "Core proposition: Your next customers are already on Instagram. BMB helps bring them to you.",
    "Required chain in order: verified observation → opportunity → concrete BMB mechanism → potential benefit → light CTA. Explain the mechanism in ONE connected statement, or two adjacent linked sentences: BMB identifies relevant Instagram audiences around competitors/similar businesses AND uses targeted interactions to bring those people to the prospect's Instagram profile, helping attract potential customers or support qualified growth. Do not omit targeted interactions or the profile destination. A list of keywords or merely finding audiences is insufficient. Describe a capability, not a guaranteed result.",
    angle === "A" ? "Angle A: growth, visibility alongside similar businesses/competitors, reaching relevant potential customers." : "Angle B: acquisition, finding potential customers in relevant Instagram audiences.",
    "Include BMB, Instagram, relevant audiences and potential customers/qualified growth explicitly. Do not offer content creation, generic engagement consultancy, automated replies or booking management.",
    angle === "A"
      ? "Mechanism example (adapt naturally): BMB identifies relevant Instagram audiences around similar businesses and uses targeted interactions to bring those people to your profile, helping grow your visibility among potential customers."
      : "Mechanism example (adapt naturally): BMB identifies relevant Instagram audiences around similar businesses and uses targeted interactions to bring those people to your profile, helping you reach potential customers.",
    `End with exactly this light CTA: ${AUDIENCE_CTA}`,
    channel === "instagram"
      ? "Instagram DM: 45–85 words, maximum 650 characters. Greeting, one short verified observation, one concrete BMB opportunity, then CTA. No subject, sign-off, signature, P.S., demo request, Meta Ads claim or long presentation."
      : "Email: 85–140 words, maximum 1200 characters, with a specific subject and short paragraphs: verified observation, opportunity, BMB value, audience angle, CTA. Do not append a signature. Do not reuse the short DM body. The optional approved comparison is exactly 'up to 3–4× less than Meta Ads'; omit unless genuinely useful. No other numerical or performance claims.",
    "Never say qualified leads eager to engage, ready to buy, guaranteed customers or guaranteed sales. Interest and purchase intent are unknown. Use potential customers or qualified growth. No unsupported praise, market leadership, inferred owner/first name, named competitor, spend, revenue, customer counts, growth rates or claims about the prospect's performance. No signature or sign-off: no canonical sender is configured. Omit missing facts.",
  ].join(" ");
}

// BMB_VALUE_PROPOSITION_PRESENT: coherent substance across the whole message,
// not an exact clause shape or a keyword bag. Deliberately deterministic.
export function hasBmbValueProposition(body: string, angle: CommercialOutreachAngle) {
  const message = clean(body);
  const bmb = message.search(/\bBMB\b/i);
  if (bmb < 0) return false;
  const proposition = message.slice(bmb, bmb + 650);
  if (/\bBMB\b[^.!?]{0,80}\b(?:not|never|cannot|can't|doesn't|won't|without)\b/i.test(proposition)) return false;
  const solutionActs = /\bBMB\b[^.!?]{0,180}\b(?:identif(?:y|ies)|finds?|targets?|locates?|reaches?|brings?|attracts?|connects?|drives?|taps? into|helps? (?:you )?(?:reach|bring|attract|connect|drive|tap into))\b/i.test(proposition);
  const instagramAudience = /\bInstagram\b/i.test(message) && (/\b(?:relevant|targeted|qualified|engaged|right)\b[^.!?]{0,45}\b(?:audiences?|followers?|people)\b|\b(?:audiences?|followers?|people)\b[^.!?]{0,45}\b(?:relevant|targeted|qualified|engaged|right)\b/i.test(message));
  const targetingContext = /\b(?:competitors?|similar businesses|targeted interactions?|people[^.!?]{0,35}(?:to|towards?) your (?:Instagram )?profile)\b/i.test(message);
  const profileMovement = /\b(?:bring|drive|direct|guide|lead|attract|connect)\b[^.!?]{0,100}\b(?:people|them|audiences?|followers?)?[^.!?]{0,45}\b(?:to|towards?) your (?:Instagram )?profile\b/i.test(message)
    || /\b(?:reach|target|tap into|connect with|attract)\b[^.!?]{0,100}\b(?:relevant|targeted|qualified|engaged|right)\b[^.!?]{0,45}\b(?:audiences?|followers?|people)\b/i.test(message);
  const benefit = /\b(?:potential customers?|qualified growth|relevant followers?|engaged followers?|qualified audience growth|(?:stronger|grow(?:ing)? (?:your )?)visibility[^.!?]{0,35}(?:right|relevant|targeted) audience|grow(?:ing)? (?:your )?(?:relevant audience|qualified audience))\b/i.test(message);
  return solutionActs && instagramAudience && targetingContext && profileMovement && benefit
    && (angle === "B" || /\b(?:grow|growth|visibility)\b/i.test(message));
}

export function inspectCommercialOutreachQuality(input: {
  body: string; subject: string | null; channel: CommercialOutreachChannel; angle: CommercialOutreachAngle;
  businessName: string; city?: string | null; verifiedFacts?: CommercialOutreachFact[];
}) {
  const body = clean(input.body);
  const combined = `${input.subject ?? ""}\n${body}`;
  const policy = commercialOutreachGreeting(input);
  const hi = policy.greeting;
  const hey = hi.replace(/^Hi /, "Hey ");
  const starts = (g: string) => body.startsWith(g) && (body.length === g.length || /\s/.test(body[g.length]));
  const naturalGreeting = starts(hi) || starts(hey);
  const valuePropClear = hasBmbValueProposition(body, input.angle);
  const sentences = body.match(/[^.!?]+[.!?]?/g) ?? [];
  const ctaClear = sentences.some((s) => /\?\s*$/.test(s) && /\b(?:show|share|see)\b/i.test(s)
    && /\b(?:audiences?|accounts?)\b/i.test(s) && /\bInstagram\b/i.test(s)
    && /\b(?:target|targeting|reach)\b/i.test(s) && /\b(?:you|your)\b/i.test(s));
  const codes: string[] = [];
  if (hasUnresolvedOutreachPlaceholder(combined)) codes.push("unresolved_placeholder");
  if (!naturalGreeting) codes.push("unnatural_or_unverified_greeting");
  if (!valuePropClear) codes.push("bmb_value_proposition_missing");
  if (!ctaClear) codes.push("concrete_audience_cta_missing");
  if (/\b(?:book|schedule)\b[^.!?]{0,35}\b(?:demo|call|meeting)\b/i.test(body)) codes.push("premature_demo_cta");
  if (/\b(?:best(?: regards)?|kind regards|regards|cheers|sincerely)\s*,/i.test(body) || /\bP\.?S\.?\s*:/i.test(body)) codes.push("incomplete_or_email_style_signature");
  if (ctaClear && !/\?\s*$/.test(body)) codes.push("content_after_cta_or_signature");
  if (/\b(?:content creation|creat(?:e|ing) (?:engaging )?content|manual content|manage your bookings|automated replies)\b/i.test(body)) codes.push("offer_positioning_mismatch");
  if (/\b(?:guarantee(?:d)?|leading (?:salon|clinic|studio)|number one|market leader)\b|\b\d[\d,.]*\s*(?:(?:new|more|extra|paying|qualified)\s+)?(?:customers?|clients?|leads?|bookings?|sales)\b/i.test(body)) codes.push("unsupported_commercial_claim");
  if (/\b(?:eager to engage|ready to buy|ready[- ]to[- ]buy|guaranteed? (?:customers|sales)|will (?:buy|book|purchase)|customers who (?:want|need) your services)\b/i.test(combined)) codes.push("assumed_purchase_intent");
  const comparison = "up to 3–4× less than Meta Ads";
  if (/Meta Ads|\d\s*[×x]|\d+\s*%/i.test(combined) && (input.channel === "instagram" || !combined.includes(comparison) || /\d\s*[×x]|\d+\s*%/i.test(combined.replace(comparison, "")))) codes.push("unapproved_performance_comparison");
  const wordCount = body.split(/\s+/).length;
  if (input.channel === "instagram" ? body.length > 650 || wordCount > 85 : body.length > 1200 || wordCount < 70 || wordCount > 160 || !/\n\s*\n/.test(input.body)) codes.push("channel_copy_structure_invalid");
  return { codes, placeholderFree: !hasUnresolvedOutreachPlaceholder(combined), naturalGreeting, valuePropClear, ctaClear, greeting: policy };
}
