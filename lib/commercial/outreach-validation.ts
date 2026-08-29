import { createHash } from "node:crypto";
import { inspectCommercialOutreachQuality } from "./outreach-quality";
import type {
  CommercialOutreachFact,
  CommercialOutreachGeneratedMessage,
} from "./outreach-contract";

const internalPattern = /system prompt|developer message|internal instruction|debug output|json payload|tool (?:call|output)|function (?:call|result)|assistant to=|\b(?:subsegment|qualification score|fact ledger)\b|```|"(?:channel|angle|facts_used|confidence)"\s*:/i;
const unsupportedClaimPattern = /(?:your|you have|you've had|you are doing)\s+(?:revenue|ad spend|customer count|growth rate|\d+\s+customers)|you(?: currently)? spend\s+[^.]*\s+on (?:Meta )?Ads|your owner|your monthly sales|your conversion rate/i;
const emailFormattingPattern = /^(?:subject|to|from):/im;
const knownCities = ["Johannesburg", "Cape Town", "Pretoria", "Durban"];
const foreignCountryPattern = /\b(?:United States|USA|United Kingdom|UK|Nigeria|Kenya|Australia|Canada|France|Germany)\b/i;

function normalized(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-ZA");
}
function contains(haystack: string, needle: string) {
  return normalized(haystack).includes(normalized(needle));
}

const semanticStopWords = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "our", "service", "services", "the", "to", "we", "with", "your"]);
function semanticTokens(value: string) {
  return normalized(value).replace(/colour/g, "color").replace(/make[ -]?up/g, "makeup")
    .replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((token) => token.length > 2 && !semanticStopWords.has(token))
    .map((token) => token.endsWith("ies") ? `${token.slice(0, -3)}y` : token.endsWith("s") && token.length > 4 ? token.slice(0, -1) : token);
}
function semanticallyContains(haystack: string, claim: string) {
  const source = new Set(semanticTokens(haystack));
  const wanted = [...new Set(semanticTokens(claim))];
  return wanted.length >= 1 && wanted.filter((token) => source.has(token)).length / wanted.length >= 0.75;
}

const serviceFamilies = [
  ["lash", /\b(?:lash(?:es)?|mega volume|russian volume)\b/i], ["brow", /\b(?:brows?|microblading)\b/i],
  ["nail", /\b(?:nails?|manicure|pedicure)\b/i], ["injectable", /\b(?:botox|fillers?|injectables?)\b/i],
  ["hair_extension", /\bhair extensions?\b/i], ["hair_color", /\bhair colou?r(?:ing)?\b/i],
  ["precision_cut", /\bprecision cuts?\b/i], ["bridal", /\bbridal\b/i], ["makeup", /\bmake[ -]?up\b/i],
] as const;

function stringRecord(value: unknown): { key: string; value: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.key !== "string" || typeof record.value !== "string") return null;
  const key = record.key.trim();
  const factValue = record.value.trim();
  return key && factValue ? { key, value: factValue } : null;
}

export function commercialOutreachContentHash(subject: string | null, body: string) {
  return createHash("sha256").update(`${subject ?? ""}\n${body}`, "utf8").digest("hex");
}

export function validateCommercialOutreachMessage(input: {
  message: CommercialOutreachGeneratedMessage;
  businessName: string;
  city: string | null;
  verifiedFacts: CommercialOutreachFact[];
  otherBusinessNames?: string[];
}) {
  const { message } = input;
  const subject = message.subject?.trim() ?? "";
  const body = message.body.trim();
  const combined = `${subject}\n${body}`;
  const codes = new Set<string>();

  if (message.channel === "instagram") {
    if (subject) codes.add("instagram_subject_forbidden");
    if (body.length < 20 || body.length > 900) codes.add("instagram_body_length_invalid");
    if (emailFormattingPattern.test(body)) codes.add("instagram_email_format_detected");
  } else {
    if (subject.length < 3 || subject.length > 120) codes.add("email_subject_length_invalid");
    if (body.length < 20 || body.length > 2000) codes.add("email_body_length_invalid");
  }

  const quality = inspectCommercialOutreachQuality({ ...input, ...message });
  for (const code of quality.codes) codes.add(code);
  // Bind the intended recipient to a verified canonical fact, not an SEO name
  // forced into the salutation. Greeting itself must match the server policy.
  if (internalPattern.test(combined)) codes.add("internal_or_debug_content");
  if (unsupportedClaimPattern.test(combined)) codes.add("unsupported_commercial_claim");
  if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(body)) codes.add("raw_json_body");

  for (const city of knownCities) {
    if (contains(combined, city) && (!input.city || normalized(city) !== normalized(input.city))) {
      codes.add("wrong_city_reference");
    }
  }
  if (foreignCountryPattern.test(combined)) codes.add("wrong_country_reference");

  for (const otherName of input.otherBusinessNames ?? []) {
    if (otherName.length >= 5 && normalized(otherName) !== normalized(input.businessName) && contains(combined, otherName)) {
      codes.add("other_business_reference");
      break;
    }
  }

  const verified = new Map(input.verifiedFacts.map((fact) => [`${normalized(fact.key)}\u0000${normalized(fact.value)}`, fact]));
  const factsUsed = Array.isArray(message.facts_used) ? message.facts_used.map(stringRecord).filter((fact): fact is { key: string; value: string } => Boolean(fact)) : [];
  if (!factsUsed.some((fact) => fact.key === "business_name" && normalized(fact.value) === normalized(input.businessName))) codes.add("business_name_missing_or_mismatched");
  if (!Array.isArray(message.facts_used) || factsUsed.length !== message.facts_used.length) codes.add("facts_used_shape_invalid");
  if (factsUsed.length === 0) codes.add("verified_personalization_missing");
  for (const fact of factsUsed) {
    if (!verified.has(`${normalized(fact.key)}\u0000${normalized(fact.value)}`)) codes.add("unverified_fact_used");
  }
  if (!factsUsed.some((fact) => fact.key !== "business_name")) codes.add("verified_personalization_missing");
  const evidenceCorpus = input.verifiedFacts.map((fact) => fact.value).join(" ");
  for (const [, pattern] of serviceFamilies) if (pattern.test(body) && !pattern.test(evidenceCorpus)) codes.add("unsupported_service_claim");
  // Generated V3 copy carries evidence, not a model's self-rated truth boolean.
  // A faithful normalized paraphrase must be supported by both the ledger and
  // the pre-BMB observation; the complete facts_used entry remains exact.
  // Owner edits / historical messages retain their existing facts contract.
  if (message.personalization_evidence) {
    const { key, quote } = message.personalization_evidence;
    const fact = input.verifiedFacts.find((candidate) => candidate.key === key);
    const observation = body.split(/\bBMB\b/i)[0];
    if (!fact || key === "business_name" || key === "instagram_handle" || key === "instagram_profile_name"
      || quote.trim().length < 3 || !semanticallyContains(fact.value, quote) || !semanticallyContains(observation, quote)
      || !factsUsed.some((used) => used.key === key && normalized(used.value) === normalized(fact.value))) codes.add("personalization_evidence_mismatch");
    if (input.verifiedFacts.some((candidate) => candidate.key === "instagram_bio")
      && (key !== "instagram_bio" || (input.city && normalized(quote) === normalized(input.city)))) codes.add("rich_personalization_missing");
  }
  if (!Number.isFinite(message.confidence) || message.confidence < 0 || message.confidence > 1) codes.add("confidence_invalid");

  return { ok: codes.size === 0, codes: [...codes].sort() };
}
