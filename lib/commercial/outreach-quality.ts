import type { CommercialOutreachAngle, CommercialOutreachChannel, CommercialOutreachFact } from "./outreach-contract";

export const OUTREACH_QUALITY_VERSION = "commercial_outreach_message_quality_v2";
export const AUDIENCE_CTA = "Would you like me to show you which Instagram audiences I'd target for your business?";

function clean(value: string) {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
}

export function hasUnresolvedOutreachPlaceholder(value: string) {
  const normalized = clean(value).replace(/&lt;|&#60;/gi, "<").replace(/&gt;|&#62;/gi, ">");
  // Bracketed substitutions have no valid use in this short plain-text copy.
  // Also reject unmatched braces/brackets rather than let malformed tokens leak.
  return /[\[\]{}<>]|\b(?:TBD|TODO|TBC|FIXME|PLACEHOLDER|INSERT[_ -]+(?:NAME|TEXT|COMPANY)|YOUR[_ -]+(?:NAME|COMPANY|BUSINESS[_ -]+NAME)|FIRST[_ -]+NAME)\b|%[A-Z_]+%|\$\w+|\bX{3,}\b/i.test(normalized);
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
    "Core proposition: Your next customers are already on Instagram. BMB helps bring them to you.",
    "Explain briefly that BMB identifies relevant Instagram audiences, including audiences of competitors or similar businesses, to help attract qualified potential customers. Describe a capability, not guaranteed outcomes or facts about a named competitor.",
    angle === "A" ? "Angle A: growth, visibility alongside similar businesses/competitors, reaching relevant potential customers." : "Angle B: acquisition, finding potential customers in relevant Instagram audiences.",
    "Include BMB, Instagram, relevant audiences and potential customers/qualified growth explicitly. Do not offer content creation, generic engagement consultancy, automated replies or booking management.",
    `End with exactly this light CTA: ${AUDIENCE_CTA}`,
    channel === "instagram"
      ? "Instagram DM: 45–85 words, maximum 650 characters. Greeting, one short verified observation, one concrete BMB opportunity, then CTA. No subject, sign-off, signature, P.S., demo request, Meta Ads claim or long presentation."
      : "Email: 85–140 words, maximum 1200 characters, with a specific subject and short paragraphs: verified observation, opportunity, BMB value, audience angle, CTA. Do not append a signature. Do not reuse the short DM body. The optional approved comparison is exactly 'up to 3–4× less than Meta Ads'; omit unless genuinely useful. No other numerical or performance claims.",
    "No unsupported praise, market leadership, inferred owner/first name, named competitor, spend, revenue, customer counts, growth rates or claims about the prospect's performance. Omit missing facts.",
  ].join(" ");
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
  const valuePropClear = /\bBMB\b/i.test(body) && /\bInstagram\b/i.test(body)
    && /\b(?:relevant|qualified|targeted)\b/i.test(body) && /\baudiences?\b/i.test(body)
    && /\b(?:customers?|prospects?|qualified growth)\b/i.test(body)
    && /\b(?:identify|identifies|find|finds|reach|reaches|connect|connects|attract|attracts|bring|brings|target|targets|help|helps)\b/i.test(body);
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
  if (/\b(?:best|regards|cheers|sincerely)\s*,\s*$/i.test(body) || /\bP\.?S\.?\s*:/i.test(body)) codes.push("incomplete_or_email_style_signature");
  if (/\b(?:content creation|creat(?:e|ing) (?:engaging )?content|manual content|manage your bookings|automated replies)\b/i.test(body)) codes.push("offer_positioning_mismatch");
  if (/\b(?:guarantee(?:d)?|leading (?:salon|clinic|studio)|number one|market leader)\b|\b\d[\d,.]*\s*(?:new |more |extra )?(?:customers?|clients?|leads?|bookings?|sales)\b/i.test(body)) codes.push("unsupported_commercial_claim");
  const comparison = "up to 3–4× less than Meta Ads";
  if (/Meta Ads|\d\s*[×x]|\d+\s*%/i.test(combined) && (input.channel === "instagram" || !combined.includes(comparison) || /\d\s*[×x]|\d+\s*%/i.test(combined.replace(comparison, "")))) codes.push("unapproved_performance_comparison");
  const wordCount = body.split(/\s+/).length;
  if (input.channel === "instagram" ? body.length > 650 || wordCount > 85 : body.length > 1200 || wordCount < 70 || wordCount > 160 || !/\n\s*\n/.test(input.body)) codes.push("channel_copy_structure_invalid");
  return { codes, placeholderFree: !hasUnresolvedOutreachPlaceholder(combined), naturalGreeting, valuePropClear, ctaClear, greeting: policy };
}
