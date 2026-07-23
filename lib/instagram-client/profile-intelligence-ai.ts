import { detectProfileLanguage } from "./profile-language.ts";

export const PROFILE_INTELLIGENCE_AI_VERSION = "profile_intelligence_v2" as const;
export const PROFILE_INTELLIGENCE_PROMPT_VERSION_FR = "profile_intelligence_v2_prompt_v5_targeting_ready_fr" as const;
export const PROFILE_INTELLIGENCE_PROMPT_VERSION_EN = "profile_intelligence_v2_prompt_v5_targeting_ready_en" as const;
export const PROFILE_INTELLIGENCE_LEGACY_PROMPT_VERSION_FR = "profile_intelligence_v2_prompt_v4_no_geo_fr" as const;
export const PROFILE_INTELLIGENCE_LEGACY_PROMPT_VERSION_EN = "profile_intelligence_v2_prompt_v4_no_geo_en" as const;
export const PROFILE_INTELLIGENCE_PROMPT_VERSION = PROFILE_INTELLIGENCE_PROMPT_VERSION_FR;
export const PROFILE_INTELLIGENCE_FORMAT_NAME = "profile_intelligence_v2" as const;
export const PROFILE_INTELLIGENCE_DEFAULT_MODEL = "gpt-4o-mini-2024-07-18";
export const PROFILE_INTELLIGENCE_TIMEOUT_MS = 8_000;
export const PROFILE_INTELLIGENCE_COOLDOWN_MS = 15 * 60 * 1_000;
export const PROFILE_INTELLIGENCE_LEASE_MS = 30_000;

export type ProfileAiConfidence = "high" | "medium" | "low";
export type ProfileAiOutputLanguage = "fr" | "en";
export type ProfileAiPromptVersion =
  | typeof PROFILE_INTELLIGENCE_PROMPT_VERSION_FR
  | typeof PROFILE_INTELLIGENCE_PROMPT_VERSION_EN
  | typeof PROFILE_INTELLIGENCE_LEGACY_PROMPT_VERSION_FR
  | typeof PROFILE_INTELLIGENCE_LEGACY_PROMPT_VERSION_EN;
export type ProfileAiEvidenceField =
  | "username"
  | "display_name"
  | "biography"
  | "official_category"
  | "is_business"
  | "followers_count"
  | "following_count"
  | "posts_count"
  | "language"
  | "external_domain"
  | "caption_samples";

export type ProfileAiSuggestion<T> = {
  value: T | null;
  confidence: ProfileAiConfidence;
  evidence_fields: ProfileAiEvidenceField[];
};

export type ProfileAiSuggestions = {
  suggested_category: ProfileAiSuggestion<string>;
  niche: ProfileAiSuggestion<string>;
  probable_audience: ProfileAiSuggestion<string>;
  themes: ProfileAiSuggestion<string[]>;
  business_description: ProfileAiSuggestion<string>;
  keywords: ProfileAiSuggestion<string[]>;
  exclusions: ProfileAiSuggestion<string[]>;
};

export type ProfileAiSuggestionKey = keyof ProfileAiSuggestions;
export type ProfileAiFieldQualityStatus = "valid" | "insufficient" | "empty_valid" | "absent" | "rejected";
export type ProfileAiFieldQualityReason =
  | "suggested_category_too_generic"
  | "niche_too_generic"
  | "niche_absent"
  | "probable_audience_too_generic"
  | "probable_audience_absent"
  | "themes_not_targeting_ready"
  | "themes_absent"
  | "business_description_too_short"
  | "keywords_not_targeting_ready"
  | "keywords_absent"
  | "optional_field_insufficient";
export type ProfileAiFieldQuality = {
  status: ProfileAiFieldQualityStatus;
  reason: ProfileAiFieldQualityReason | null;
};
export type ProfileAiFieldQualityMap = Record<ProfileAiSuggestionKey, ProfileAiFieldQuality>;

export type ProfileAiConfirmedValues = {
  suggested_category: string | null;
  niche: string | null;
  probable_audience: string | null;
  themes: string[];
  business_description: string | null;
  keywords: string[];
  exclusions: string[];
};

export type StoredProfileAiAnalysis = {
  status: "not_started" | "running" | "completed" | "failed_retryable";
  request_key: string | null;
  analysis_version: typeof PROFILE_INTELLIGENCE_AI_VERSION;
  prompt_version: ProfileAiPromptVersion;
  output_language: ProfileAiOutputLanguage;
  model: string;
  requested_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  lease_expires_at: string | null;
  error_code: string | null;
  confirmation_status: "pending" | "confirmed";
  confirmed_at: string | null;
  suggestions: ProfileAiSuggestions | null;
  confirmed_values: ProfileAiConfirmedValues | null;
  field_quality: ProfileAiFieldQualityMap | null;
  targeting_quality_valid: boolean | null;
  metrics: {
    provider_duration_ms: number | null;
    total_duration_ms: number | null;
    input_bytes: number | null;
    output_bytes: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    estimated_cost_usd: number | null;
  };
};

type UnknownRecord = Record<string, unknown>;

export type ProfileIntelligencePromptSnapshot = {
  output_language: ProfileAiOutputLanguage;
  profile_language: ProfileAiOutputLanguage | null;
  username: string;
  display_name?: string;
  biography?: string;
  official_category?: string;
  is_business?: boolean;
  followers_count?: number;
  following_count?: number;
  posts_count?: number;
  external_domain?: string;
  caption_samples?: string[];
};

export type ProfileIntelligenceProviderResult = {
  ok: boolean;
  suggestions: ProfileAiSuggestions | null;
  errorCode: string | null;
  providerCallAttempted: boolean;
  model: string;
  outputLanguage: ProfileAiOutputLanguage;
  schemaValid: boolean;
  businessOutputValid: boolean;
  noGeoValid: boolean;
  targetingQualityValid: boolean;
  fieldQuality: ProfileAiFieldQualityMap | null;
  languageValidation: ProfileAiLanguageValidation;
  targetingQualityValidation: ProfileAiTargetingQualityValidation | null;
  metrics: StoredProfileAiAnalysis["metrics"];
  diagnostic: {
    http_status: number | null;
    error_type: string | null;
    error_code: string | null;
    error_param: string | null;
    request_id: string | null;
    category: string | null;
  };
};

const evidenceFields = new Set<ProfileAiEvidenceField>([
  "username", "display_name", "biography", "official_category", "is_business",
  "followers_count", "following_count", "posts_count", "language",
  "external_domain", "caption_samples",
]);

export const PROFILE_AI_SUGGESTION_KEYS = [
  "suggested_category", "niche", "probable_audience", "themes",
  "business_description", "keywords", "exclusions",
] as const;
const suggestionKeys = PROFILE_AI_SUGGESTION_KEYS;

const geographicOutputKey = /(?:^|_)(?:suggested_activity_area|suggested_location|location|city|country|region|geographic_area|geography|service_area|activity_area)(?:_|$)/i;

export function containsAiGeographicKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAiGeographicKey);
  const row = record(value);
  return Object.entries(row).some(([key, child]) => geographicOutputKey.test(key) || containsAiGeographicKey(child));
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, limit = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, limit);
  return normalized || null;
}

function promptText(value: unknown, limit: number) {
  const raw = text(value, Math.max(limit * 2, limit));
  if (!raw) return null;
  return raw
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, " ")
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit) || null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function stringList(value: unknown, limit: number, itemLimit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const next = text(item, itemLimit);
    return next ? [next] : [];
  }))].slice(0, limit);
}

function promptStringList(value: unknown, limit: number, itemLimit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const next = promptText(item, itemLimit);
    return next ? [next] : [];
  }))].slice(0, limit);
}

function safeExternalDomain(value: unknown) {
  const url = text(value, 2048);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.hostname.replace(/^www\./i, "").toLowerCase().slice(0, 253)
      : null;
  } catch {
    return null;
  }
}

export function buildProfileIntelligencePromptSnapshot(input: {
  outputLanguage?: unknown;
  username?: unknown;
  displayName?: unknown;
  biography?: unknown;
  category?: unknown;
  isBusiness?: unknown;
  followersCount?: unknown;
  followingCount?: unknown;
  postsCount?: unknown;
  language?: unknown;
  location?: unknown;
  externalUrl?: unknown;
  recentCaptionSamples?: unknown;
}): ProfileIntelligencePromptSnapshot {
  const outputLanguage = resolveProfileAiOutputLanguage(input.outputLanguage, input.language);
  const profileLanguage = input.language === "fr" || input.language === "en" ? input.language : null;
  const displayName = promptText(input.displayName, 500);
  const biography = promptText(input.biography, 2_000);
  const officialCategory = promptText(input.category, 500);
  const isBusiness = typeof input.isBusiness === "boolean" ? input.isBusiness : null;
  const followersCount = numberOrNull(input.followersCount);
  const followingCount = numberOrNull(input.followingCount);
  const postsCount = numberOrNull(input.postsCount);
  const externalDomain = safeExternalDomain(input.externalUrl);
  const captionSamples = promptStringList(input.recentCaptionSamples, 5, 280);
  return {
    output_language: outputLanguage,
    profile_language: profileLanguage,
    username: text(input.username, 30) ?? "",
    ...(displayName ? { display_name: displayName } : {}),
    ...(biography ? { biography } : {}),
    ...(officialCategory ? { official_category: officialCategory } : {}),
    ...(isBusiness !== null ? { is_business: isBusiness } : {}),
    ...(followersCount !== null ? { followers_count: followersCount } : {}),
    ...(followingCount !== null ? { following_count: followingCount } : {}),
    ...(postsCount !== null ? { posts_count: postsCount } : {}),
    ...(externalDomain ? { external_domain: externalDomain } : {}),
    ...(captionSamples.length ? { caption_samples: captionSamples } : {}),
  };
}

export function resolveProfileAiOutputLanguage(explicitLocale: unknown, profileLanguage: unknown): ProfileAiOutputLanguage {
  if (explicitLocale === "fr" || explicitLocale === "en") return explicitLocale;
  if (profileLanguage === "fr" || profileLanguage === "en") return profileLanguage;
  return "fr";
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
function stringArray(maxItems: number) {
  return { type: "array", items: { type: "string" }, maxItems } as const;
}
const evidenceArray = {
  type: "array",
  items: { type: "string", enum: [...evidenceFields] },
  maxItems: 6,
} as const;

function suggestionSchema(value: unknown) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["value", "confidence", "evidence_fields"],
    properties: {
      value,
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      evidence_fields: evidenceArray,
    },
  };
}

export function profileIntelligenceStructuredOutputSchema(outputLanguage: ProfileAiOutputLanguage) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["analysis_version", "output_language", "suggestions"],
    properties: {
      analysis_version: { type: "string", enum: [PROFILE_INTELLIGENCE_AI_VERSION] },
      output_language: { type: "string", enum: [outputLanguage] },
      suggestions: {
        type: "object",
        additionalProperties: false,
        required: [...suggestionKeys],
        properties: {
          suggested_category: suggestionSchema(nullableString),
          niche: suggestionSchema(nullableString),
          probable_audience: suggestionSchema(nullableString),
          themes: suggestionSchema(stringArray(8)),
          business_description: suggestionSchema(nullableString),
          keywords: suggestionSchema(stringArray(20)),
          exclusions: suggestionSchema(stringArray(20)),
        },
      },
    },
  } as const;
}

export const PROFILE_INTELLIGENCE_STRUCTURED_OUTPUT_SCHEMA = profileIntelligenceStructuredOutputSchema("fr");

export const PROFILE_INTELLIGENCE_SYSTEM_PROMPT_FR = [
  "Analyse uniquement les données publiques fournies, sans recherche externe ni hypothèse présentée comme un fait.",
  "Valeurs client uniquement en français naturel. Garde marques, noms propres, usernames, acronymes et termes techniques intraduisibles dans leur langue d'origine ; évite le mélange français-anglais.",
  "Localisation hors analyse : aucune ville, pays, région ou zone géographique.",
  "N'invente ni statut business, visibilité, vérification, catégorie officielle ou donnée privée. Retourne null ou [] sans preuve.",
  "Ces résultats serviront à définir le ciblage client, générer des recherches de comptes cibles, puis classer et filtrer des profils Instagram potentiels.",
  "Privilégie précision métier, formulations naturelles, segments d'audience concrets, expressions de recherche distinctives et termes commercialement exploitables.",
  "Catégorie suggérée : activité compréhensible, naturelle, idéalement 2 à 6 mots, distincte de la catégorie officielle et de la niche ; évite les libellés génériques comme automatisation marketing.",
  "Niche : 4 à 12 mots décrivant domaine, plateforme ou canal si prouvé, et finalité commerciale.",
  "Audience probable : 8 à 30 mots, 2 à 5 segments concrets si prouvés, avec leur besoin ou intention commerciale ; aucune démographie inventée.",
  "Thèmes : 4 à 7 expressions distinctes de 2 à 5 mots, utiles au ciblage, dédupliquées sémantiquement ; évite les mots génériques isolés.",
  "Description d'activité : phrase naturelle de 12 à 35 mots précisant service, canal et bénéfice prouvé ; null seulement si les preuves sont insuffisantes.",
  "Mots-clés : 5 à 8 expressions distinctives de 2 à 4 mots dans la langue de sortie ; un mot seul uniquement s'il est distinctif ; déduplique variantes et quasi-synonymes.",
  "Exclusions : [] avec confiance low et aucune preuve est un résultat valide si aucune exclusion fiable n'est justifiée ; n'en invente jamais.",
  "evidence_fields : noms de champs uniquement. Aucune longue explication ni chaîne de raisonnement.",
].join("\n");

export const PROFILE_INTELLIGENCE_SYSTEM_PROMPT_EN = [
  "Analyze only supplied public Instagram data, without external research or presenting inference as fact.",
  "Client-facing values only in natural English. Keep brands, proper nouns, usernames, acronyms, and untranslatable technical terms in their original language; avoid English-French mixing.",
  "Location outside this analysis: no city, country, region, or geographic area.",
  "Invent neither business status, visibility, verification, official category, nor private data. Return null or [] without evidence.",
  "These results will define client targeting, generate target-account searches, then classify and filter potential Instagram profiles.",
  "Prioritize business precision, natural wording, concrete audience segments, distinctive search phrases, and commercially useful terms.",
  "Suggested category: a clear natural activity label, ideally 2 to 6 words, distinct from the official category and niche; avoid generic labels such as marketing automation.",
  "Niche: 4 to 12 words covering the domain, evidenced platform or channel, and primary commercial purpose.",
  "Likely audience: 8 to 30 words, 2 to 5 concrete evidenced segments, and their commercial need or intent; invent no demographics.",
  "Themes: 4 to 7 distinct 2-to-5-word phrases useful for targeting, semantically deduplicated; avoid isolated generic words.",
  "Business description: a natural 12-to-35-word sentence covering the service, channel, and evidenced benefit; use null only when evidence is insufficient.",
  "Keywords: 5 to 8 distinctive 2-to-4-word search phrases in the output language; allow a single word only when distinctive; deduplicate variants and near-synonyms.",
  "Exclusions: [] with low confidence and no evidence is a valid result when no reliable exclusion is justified; never invent exclusions.",
  "evidence_fields: field names only. No long explanation or chain of thought.",
].join("\n");

export const PROFILE_INTELLIGENCE_SYSTEM_PROMPT = PROFILE_INTELLIGENCE_SYSTEM_PROMPT_FR;

export function profileIntelligencePromptVersion(outputLanguage: ProfileAiOutputLanguage): ProfileAiPromptVersion {
  return outputLanguage === "en" ? PROFILE_INTELLIGENCE_PROMPT_VERSION_EN : PROFILE_INTELLIGENCE_PROMPT_VERSION_FR;
}

export function profileIntelligenceSystemPrompt(outputLanguage: ProfileAiOutputLanguage) {
  return outputLanguage === "en" ? PROFILE_INTELLIGENCE_SYSTEM_PROMPT_EN : PROFILE_INTELLIGENCE_SYSTEM_PROMPT_FR;
}

export function buildProfileIntelligenceUserPrompt(snapshot: ProfileIntelligencePromptSnapshot) {
  const { output_language, profile_language, ...publicFacts } = snapshot;
  return [
    `prompt_version=${profileIntelligencePromptVersion(output_language)}`,
    `output_language=${output_language}`,
    `profile_language=${profile_language ?? "unknown"}`,
    `public_facts=${JSON.stringify(publicFacts)}`,
  ].join("\n");
}

function confidence(value: unknown): ProfileAiConfidence | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

function evidence(value: unknown) {
  if (!Array.isArray(value)) return null;
  const sanitized = [...new Set(value.filter((item): item is ProfileAiEvidenceField => typeof item === "string" && evidenceFields.has(item as ProfileAiEvidenceField)))];
  return sanitized.length === value.length && sanitized.length <= 6 ? sanitized : null;
}

function parseSuggestion(value: unknown, kind: "text"): ProfileAiSuggestion<string> | null;
function parseSuggestion(value: unknown, kind: "list"): ProfileAiSuggestion<string[]> | null;
function parseSuggestion(value: unknown, kind: "text" | "list"): ProfileAiSuggestion<string> | ProfileAiSuggestion<string[]> | null {
  const row = record(value);
  if (Object.keys(row).sort().join(",") !== "confidence,evidence_fields,value") return null;
  const parsedConfidence = confidence(row.confidence);
  const parsedEvidence = evidence(row.evidence_fields);
  if (!parsedConfidence || !parsedEvidence) return null;
  if (kind === "list") {
    if (!Array.isArray(row.value)) return null;
    return { value: stringList(row.value, 8, 80), confidence: parsedConfidence, evidence_fields: parsedEvidence };
  }
  if (row.value !== null && typeof row.value !== "string") return null;
  return { value: text(row.value, 500), confidence: parsedConfidence, evidence_fields: parsedEvidence };
}

export function validateProfileAiStructuredOutput(
  value: unknown,
  expectedOutputLanguage: ProfileAiOutputLanguage = "fr",
): ProfileAiSuggestions | null {
  if (containsAiGeographicKey(value)) return null;
  const root = record(value);
  if (Object.keys(root).sort().join(",") !== "analysis_version,output_language,suggestions") return null;
  if (root.analysis_version !== PROFILE_INTELLIGENCE_AI_VERSION) return null;
  if (root.output_language !== expectedOutputLanguage) return null;
  const rows = record(root.suggestions);
  if (Object.keys(rows).sort().join(",") !== [...suggestionKeys].sort().join(",")) return null;
  const suggestedCategory = parseSuggestion(rows.suggested_category, "text");
  const niche = parseSuggestion(rows.niche, "text");
  const probableAudience = parseSuggestion(rows.probable_audience, "text");
  const themes = parseSuggestion(rows.themes, "list");
  const businessDescription = parseSuggestion(rows.business_description, "text");
  const keywords = parseSuggestion(rows.keywords, "list");
  const exclusions = parseSuggestion(rows.exclusions, "list");
  if (!suggestedCategory || !niche || !probableAudience || !themes || !businessDescription || !keywords || !exclusions) return null;
  return {
    suggested_category: suggestedCategory,
    niche,
    probable_audience: probableAudience,
    themes,
    business_description: businessDescription,
    keywords,
    exclusions,
  };
}

export type ProfileAiLanguageValidation = {
  valid: boolean;
  detected_language: ProfileAiOutputLanguage | null;
  reason: "matched" | "clear_mismatch" | "insufficient_or_ambiguous";
};

export type ProfileAiTargetingQualityValidation = {
  valid: boolean;
  reasons: ProfileAiFieldQualityReason[];
  fieldQuality: ProfileAiFieldQualityMap;
  suggestions: ProfileAiSuggestions;
};

function suggestionBusinessStrings(suggestions: ProfileAiSuggestions) {
  return [
    suggestions.suggested_category.value,
    suggestions.niche.value,
    suggestions.probable_audience.value,
    ...(suggestions.themes.value ?? []),
    suggestions.business_description.value,
    ...(suggestions.keywords.value ?? []),
    ...(suggestions.exclusions.value ?? []),
  ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
}

export function validateProfileAiOutputLanguage(
  suggestions: ProfileAiSuggestions,
  expectedOutputLanguage: ProfileAiOutputLanguage,
): ProfileAiLanguageValidation {
  const aggregate = detectProfileLanguage({ biography: suggestionBusinessStrings(suggestions).join(". ") });
  const keywords = detectProfileLanguage({ biography: (suggestions.keywords.value ?? []).join(". ") });
  const mismatch = [aggregate, keywords].some((result) => result.language && result.language !== expectedOutputLanguage);
  if (mismatch) {
    return {
      valid: false,
      detected_language: aggregate.language ?? keywords.language,
      reason: "clear_mismatch",
    };
  }
  if (!aggregate.language) {
    return { valid: true, detected_language: null, reason: "insufficient_or_ambiguous" };
  }
  return { valid: true, detected_language: aggregate.language, reason: "matched" };
}

const genericSingleTerms = new Set([
  "instagram", "marketing", "automatisation", "automation", "strategie", "strategy",
  "croissance", "growth", "performance", "business", "entrepreneur", "entrepreneurs",
  "professionnel", "professionnels", "professional", "professionals", "entreprise",
  "entreprises", "company", "companies", "service", "services", "digital", "content",
]);

const audienceIntentTerms = new Set([
  "souhaitant", "cherchant", "voulant", "besoin", "besoins", "objectif", "objectifs",
  "developper", "ameliorer", "automatiser", "acquerir", "generer", "pour",
  "seeking", "wanting", "looking", "need", "needs", "aiming", "grow", "improve",
  "automate", "acquire", "generate", "increase", "for",
]);

function normalizedWords(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function semanticKey(value: string) {
  return normalizedWords(value)
    .map((word) => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word)
    .join(" ");
}

function isGenericSingle(value: string) {
  const words = normalizedWords(value);
  return words.length === 1 && genericSingleTerms.has(words[0]);
}

function usefulDistinctItems(values: string[], maxItems: number, rejectGenericSingles = true) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const key = semanticKey(value);
    if (!key || seen.has(key) || (rejectGenericSingles && isGenericSingle(value))) return [];
    seen.add(key);
    return [value];
  }).slice(0, maxItems);
}

function quality(status: ProfileAiFieldQualityStatus, reason: ProfileAiFieldQualityReason | null = null): ProfileAiFieldQuality {
  return { status, reason };
}

export function validateProfileAiTargetingQuality(
  suggestions: ProfileAiSuggestions,
): ProfileAiTargetingQualityValidation {
  const reasons: ProfileAiFieldQualityReason[] = [];
  const category = suggestions.suggested_category.value?.trim() ?? "";
  const categoryWords = normalizedWords(category);
  const categoryQuality = !category
    ? quality("empty_valid")
    : categoryWords.length < 2 || (categoryWords.length <= 2 && categoryWords.every((word) => genericSingleTerms.has(word)))
      ? quality("insufficient", "suggested_category_too_generic")
      : quality("valid");
  if (categoryQuality.reason) {
    reasons.push("suggested_category_too_generic");
  }

  const niche = suggestions.niche.value?.trim() ?? "";
  const nicheQuality = !niche
    ? quality("absent", "niche_absent")
    : normalizedWords(niche).length < 4 || isGenericSingle(niche)
      ? quality("insufficient", "niche_too_generic")
      : quality("valid");
  if (nicheQuality.reason) reasons.push(nicheQuality.reason);

  const audience = suggestions.probable_audience.value?.trim() ?? "";
  const audienceWords = normalizedWords(audience);
  const audienceQuality = !audience
    ? quality("absent", "probable_audience_absent")
    : audienceWords.length < 8 || !audienceWords.some((word) => audienceIntentTerms.has(word))
      ? quality("insufficient", "probable_audience_too_generic")
      : quality("valid");
  if (audienceQuality.reason) reasons.push(audienceQuality.reason);

  const rawThemes = suggestions.themes.value ?? [];
  const themes = usefulDistinctItems(rawThemes, 7);
  const themesQuality = rawThemes.length === 0
    ? quality("absent", "themes_absent")
    : themes.length === 0
      ? quality("rejected", "themes_not_targeting_ready")
    : themes.length < 3
      ? quality("insufficient", "themes_not_targeting_ready")
      : quality("valid");
  if (themesQuality.reason) reasons.push(themesQuality.reason);

  const description = suggestions.business_description.value?.trim() ?? null;
  const descriptionQuality = !description
    ? quality("empty_valid")
    : normalizedWords(description).length < 8 || description.length < 45
      ? quality("insufficient", "business_description_too_short")
      : quality("valid");
  if (descriptionQuality.reason) reasons.push(descriptionQuality.reason);

  const rawKeywords = suggestions.keywords.value ?? [];
  const keywords = usefulDistinctItems(rawKeywords, 8);
  const keywordsQuality = rawKeywords.length === 0
    ? quality("absent", "keywords_absent")
    : keywords.length === 0
      ? quality("rejected", "keywords_not_targeting_ready")
    : keywords.length < 4
      ? quality("insufficient", "keywords_not_targeting_ready")
      : quality("valid");
  if (keywordsQuality.reason) reasons.push(keywordsQuality.reason);

  const exclusions = usefulDistinctItems(suggestions.exclusions.value ?? [], 8, false);
  const exclusionsQuality = exclusions.length ? quality("valid") : quality("empty_valid");
  const fieldQuality: ProfileAiFieldQualityMap = {
    suggested_category: categoryQuality,
    niche: nicheQuality,
    probable_audience: audienceQuality,
    themes: themesQuality,
    business_description: descriptionQuality,
    keywords: keywordsQuality,
    exclusions: exclusionsQuality,
  };
  const valid = nicheQuality.status === "valid"
    && audienceQuality.status === "valid"
    && themes.length >= 3
    && keywords.length >= 4;
  return {
    valid,
    reasons,
    fieldQuality,
    suggestions: {
      suggested_category: { ...suggestions.suggested_category, value: categoryQuality.status === "valid" ? category : null },
      niche: { ...suggestions.niche, value: nicheQuality.status === "valid" ? niche : null },
      probable_audience: { ...suggestions.probable_audience, value: audienceQuality.status === "valid" ? audience : null },
      themes: { ...suggestions.themes, value: themes },
      business_description: { ...suggestions.business_description, value: descriptionQuality.status === "valid" ? description : null },
      keywords: { ...suggestions.keywords, value: keywords },
      exclusions: { ...suggestions.exclusions, value: exclusions },
    },
  };
}

export function emptyProfileAiAnalysis(
  model = PROFILE_INTELLIGENCE_DEFAULT_MODEL,
  outputLanguage: ProfileAiOutputLanguage = "fr",
): StoredProfileAiAnalysis {
  return {
    status: "not_started",
    request_key: null,
    analysis_version: PROFILE_INTELLIGENCE_AI_VERSION,
    prompt_version: profileIntelligencePromptVersion(outputLanguage),
    output_language: outputLanguage,
    model,
    requested_at: null,
    completed_at: null,
    failed_at: null,
    lease_expires_at: null,
    error_code: null,
    confirmation_status: "pending",
    confirmed_at: null,
    suggestions: null,
    confirmed_values: null,
    field_quality: null,
    targeting_quality_valid: null,
    metrics: {
      provider_duration_ms: null,
      total_duration_ms: null,
      input_bytes: null,
      output_bytes: null,
      input_tokens: null,
      output_tokens: null,
      estimated_cost_usd: null,
    },
  };
}

export function readStoredProfileAiAnalysis(value: unknown): StoredProfileAiAnalysis {
  const row = record(value);
  const storedOutputLanguage = row.output_language === "en" ? "en" : "fr";
  const fallback = emptyProfileAiAnalysis(text(row.model, 120) ?? PROFILE_INTELLIGENCE_DEFAULT_MODEL, storedOutputLanguage);
  const storedPromptVersion = row.prompt_version === PROFILE_INTELLIGENCE_PROMPT_VERSION_FR
    || row.prompt_version === PROFILE_INTELLIGENCE_PROMPT_VERSION_EN
    || row.prompt_version === PROFILE_INTELLIGENCE_LEGACY_PROMPT_VERSION_FR
    || row.prompt_version === PROFILE_INTELLIGENCE_LEGACY_PROMPT_VERSION_EN
    ? row.prompt_version
    : fallback.prompt_version;
  const status = row.status;
  const suggestions = validateProfileAiStructuredOutput({
    analysis_version: PROFILE_INTELLIGENCE_AI_VERSION,
    output_language: storedOutputLanguage,
    suggestions: Object.fromEntries(suggestionKeys.map((key) => [key, record(row.suggestions)[key]])),
  }, storedOutputLanguage);
  const confirmed = record(row.confirmed_values);
  const storedFieldQuality = record(row.field_quality);
  const validQualityStatuses = new Set<ProfileAiFieldQualityStatus>(["valid", "insufficient", "empty_valid", "absent", "rejected"]);
  const validQualityReasons = new Set<ProfileAiFieldQualityReason>([
    "suggested_category_too_generic", "niche_too_generic", "niche_absent",
    "probable_audience_too_generic", "probable_audience_absent", "themes_not_targeting_ready",
    "themes_absent", "business_description_too_short", "keywords_not_targeting_ready",
    "keywords_absent", "optional_field_insufficient",
  ]);
  const fieldQuality = suggestionKeys.every((key) => {
    const entry = record(storedFieldQuality[key]);
    return validQualityStatuses.has(entry.status as ProfileAiFieldQualityStatus)
      && (entry.reason === null || validQualityReasons.has(entry.reason as ProfileAiFieldQualityReason));
  }) ? Object.fromEntries(suggestionKeys.map((key) => {
    const entry = record(storedFieldQuality[key]);
    return [key, {
      status: entry.status as ProfileAiFieldQualityStatus,
      reason: entry.reason as ProfileAiFieldQualityReason | null,
    }];
  })) as ProfileAiFieldQualityMap : null;
  const metrics = record(row.metrics);
  return {
    ...fallback,
    prompt_version: storedPromptVersion,
    status: status === "running" || status === "completed" || status === "failed_retryable" ? status : "not_started",
    request_key: text(row.request_key, 80),
    requested_at: text(row.requested_at, 80),
    completed_at: text(row.completed_at, 80),
    failed_at: text(row.failed_at, 80),
    lease_expires_at: text(row.lease_expires_at, 80),
    error_code: text(row.error_code, 120),
    confirmation_status: row.confirmation_status === "confirmed" ? "confirmed" : "pending",
    confirmed_at: text(row.confirmed_at, 80),
    suggestions,
    confirmed_values: Object.keys(confirmed).length ? {
      suggested_category: text(confirmed.suggested_category, 500),
      niche: text(confirmed.niche, 500),
      probable_audience: text(confirmed.probable_audience, 500),
      themes: stringList(confirmed.themes, 8, 80),
      business_description: text(confirmed.business_description, 1_000),
      keywords: stringList(confirmed.keywords, 20, 80),
      exclusions: stringList(confirmed.exclusions, 20, 80),
    } : null,
    field_quality: fieldQuality,
    targeting_quality_valid: typeof row.targeting_quality_valid === "boolean" ? row.targeting_quality_valid : null,
    metrics: {
      provider_duration_ms: numberOrNull(metrics.provider_duration_ms),
      total_duration_ms: numberOrNull(metrics.total_duration_ms),
      input_bytes: numberOrNull(metrics.input_bytes),
      output_bytes: numberOrNull(metrics.output_bytes),
      input_tokens: numberOrNull(metrics.input_tokens),
      output_tokens: numberOrNull(metrics.output_tokens),
      estimated_cost_usd: typeof metrics.estimated_cost_usd === "number" && Number.isFinite(metrics.estimated_cost_usd)
        ? Math.max(0, metrics.estimated_cost_usd)
        : null,
    },
  };
}

export function profileAiModel() {
  return process.env.PROFILE_INTELLIGENCE_AI_MODEL?.trim() || PROFILE_INTELLIGENCE_DEFAULT_MODEL;
}

export function profileAiBaseUrl() {
  return (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com").replace(/\/+$/, "");
}

function responseText(payload: unknown) {
  const row = record(payload);
  const output = Array.isArray(row.output) ? row.output : [];
  for (const item of output) {
    const content = Array.isArray(record(item).content) ? record(item).content as unknown[] : [];
    for (const part of content) {
      const contentPart = record(part);
      if (contentPart.type === "output_text") return text(contentPart.text, 20_000) ?? "";
    }
  }
  return "";
}

function safeDiagnosticValue(value: unknown) {
  return text(value, 120);
}

function providerErrorCategory(status: number, error: UnknownRecord) {
  const type = safeDiagnosticValue(error.type)?.toLowerCase() ?? "";
  const code = safeDiagnosticValue(error.code)?.toLowerCase() ?? "";
  const param = safeDiagnosticValue(error.param)?.toLowerCase() ?? "";
  if (status === 401 || status === 403) return "provider_auth_failed";
  if (code === "model_not_found" || (status === 404 && param === "model")) return "provider_model_unavailable";
  if (status === 429 && (code === "insufficient_quota" || type === "insufficient_quota")) return "provider_quota_exceeded";
  if (status === 429) return "provider_rate_limited";
  if (status === 400 && (/schema|text\.format|response_format/.test(param) || /schema/.test(code))) return "provider_schema_rejected";
  if (status === 400 || status === 422) return "provider_invalid_request";
  if (status >= 500) return "provider_temporary_failure";
  return "provider_unavailable";
}

function providerDiagnostic(response: Response, payload: unknown) {
  const error = record(record(payload).error);
  const category = response.ok ? null : providerErrorCategory(response.status, error);
  return {
    http_status: response.status,
    error_type: safeDiagnosticValue(error.type),
    error_code: safeDiagnosticValue(error.code),
    error_param: safeDiagnosticValue(error.param),
    request_id: safeDiagnosticValue(response.headers.get("x-request-id")),
    category,
  };
}

export async function callProfileIntelligenceOpenAi(input: {
  snapshot: ProfileIntelligencePromptSnapshot;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  apiKey?: string;
  model?: string;
}): Promise<ProfileIntelligenceProviderResult> {
  const startedAt = Date.now();
  const model = input.model || profileAiModel();
  const outputLanguage = input.snapshot.output_language;
  const systemPrompt = profileIntelligenceSystemPrompt(outputLanguage);
  const apiKey = input.apiKey ?? process.env.OPENAI_API_KEY?.trim() ?? "";
  const userPrompt = buildProfileIntelligenceUserPrompt(input.snapshot);
  const inputBytes = Buffer.byteLength(systemPrompt) + Buffer.byteLength(userPrompt);
  const emptyMetrics = {
    provider_duration_ms: null,
    total_duration_ms: Date.now() - startedAt,
    input_bytes: inputBytes,
    output_bytes: null,
    input_tokens: null,
    output_tokens: null,
    estimated_cost_usd: null,
  };
  const emptyDiagnostic = {
    http_status: null,
    error_type: null,
    error_code: null,
    error_param: null,
    request_id: null,
    category: null,
  };
  if (!apiKey) return {
    ok: false,
    suggestions: null,
    errorCode: "provider_key_missing",
    providerCallAttempted: false,
    model,
    outputLanguage,
    schemaValid: false,
    businessOutputValid: false,
    noGeoValid: true,
    targetingQualityValid: false,
    fieldQuality: null,
    languageValidation: { valid: false, detected_language: null, reason: "insufficient_or_ambiguous" },
    targetingQualityValidation: null,
    metrics: emptyMetrics,
    diagnostic: { ...emptyDiagnostic, category: "provider_key_missing" },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? PROFILE_INTELLIGENCE_TIMEOUT_MS);
  const providerStartedAt = Date.now();
  let response: Response;
  let payload: unknown = null;
  try {
    const providerRequest: Record<string, unknown> = {
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: [{ type: "input_text", text: userPrompt }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: PROFILE_INTELLIGENCE_FORMAT_NAME,
          strict: true,
          schema: profileIntelligenceStructuredOutputSchema(outputLanguage),
        },
      },
      max_output_tokens: 1_000,
      store: false,
    };
    response = await (input.fetchImpl ?? fetch)(`${profileAiBaseUrl()}/v1/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(providerRequest),
      cache: "no-store",
      signal: controller.signal,
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (error instanceof Error && (error.name === "AbortError" || /timeout|aborted/i.test(error.message))) throw error;
      payload = null;
    }
  } catch (error) {
    const errorCode = error instanceof Error && (error.name === "AbortError" || /timeout|aborted/i.test(error.message))
      ? "provider_timeout"
      : "provider_unavailable";
    return {
      ok: false,
      suggestions: null,
      errorCode,
      providerCallAttempted: true,
      model,
      outputLanguage,
      schemaValid: false,
      businessOutputValid: false,
      noGeoValid: true,
      targetingQualityValid: false,
      fieldQuality: null,
      languageValidation: { valid: false, detected_language: null, reason: "insufficient_or_ambiguous" },
      targetingQualityValidation: null,
      metrics: { ...emptyMetrics, provider_duration_ms: Date.now() - providerStartedAt, total_duration_ms: Date.now() - startedAt },
      diagnostic: {
        ...emptyDiagnostic,
        category: errorCode,
        error_type: error instanceof Error ? safeDiagnosticValue(error.name) : null,
      },
    };
  } finally {
    clearTimeout(timeout);
  }

  const providerDuration = Date.now() - providerStartedAt;
  const diagnostic = providerDiagnostic(response, payload);
  if (!response.ok) {
    return {
      ok: false,
      suggestions: null,
      errorCode: diagnostic.category,
      providerCallAttempted: true,
      model,
      outputLanguage,
      schemaValid: false,
      businessOutputValid: false,
      noGeoValid: true,
      targetingQualityValid: false,
      fieldQuality: null,
      languageValidation: { valid: false, detected_language: null, reason: "insufficient_or_ambiguous" },
      targetingQualityValidation: null,
      metrics: { ...emptyMetrics, provider_duration_ms: providerDuration, total_duration_ms: Date.now() - startedAt },
      diagnostic,
    };
  }

  const content = responseText(payload);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  const noGeoValid = !containsAiGeographicKey(parsed);
  const schemaSuggestions = validateProfileAiStructuredOutput(parsed, outputLanguage);
  const schemaValid = Boolean(schemaSuggestions);
  const languageValidation = schemaSuggestions
    ? validateProfileAiOutputLanguage(schemaSuggestions, outputLanguage)
    : { valid: false as const, detected_language: null, reason: "insufficient_or_ambiguous" as const };
  const businessOutputValid = schemaValid && languageValidation.valid;
  const targetingQualityValidation = businessOutputValid && schemaSuggestions
    ? validateProfileAiTargetingQuality(schemaSuggestions)
    : null;
  const targetingQualityValid = targetingQualityValidation?.valid ?? false;
  const fieldQuality = targetingQualityValidation?.fieldQuality ?? null;
  const suggestions = businessOutputValid && targetingQualityValidation?.valid ? targetingQualityValidation.suggestions : null;
  const usage = record(record(payload).usage);
  const inputTokens = numberOrNull(usage.input_tokens);
  const outputTokens = numberOrNull(usage.output_tokens);
  const normalizedModel = model.trim().toLowerCase();
  const tokenRates = /^gpt-4\.1-mini(?:-2025-04-14)?$/.test(normalizedModel)
    ? { input: 0.4, output: 1.6 }
    : /^gpt-4o-mini(?:-2024-07-18)?$/.test(normalizedModel)
      ? { input: 0.15, output: 0.6 }
      : null;
  const estimatedCost = inputTokens === null || outputTokens === null || !tokenRates
    ? null
    : Number(((inputTokens * tokenRates.input + outputTokens * tokenRates.output) / 1_000_000).toFixed(8));
  const metrics = {
    provider_duration_ms: providerDuration,
    total_duration_ms: Date.now() - startedAt,
    input_bytes: inputBytes,
    output_bytes: Buffer.byteLength(content),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: estimatedCost,
  };
  return suggestions
    ? {
      ok: true,
      suggestions,
      errorCode: null,
      providerCallAttempted: true,
      model,
      outputLanguage,
      schemaValid,
      businessOutputValid,
      noGeoValid,
      targetingQualityValid,
      fieldQuality,
      languageValidation,
      targetingQualityValidation,
      metrics,
      diagnostic,
    }
    : {
      ok: false,
      suggestions: null,
      errorCode: !schemaValid
        ? "invalid_ai_output"
        : !languageValidation.valid
          ? "output_language_mismatch"
          : "output_targeting_quality_insufficient",
      providerCallAttempted: true,
      model,
      outputLanguage,
      schemaValid,
      businessOutputValid,
      noGeoValid,
      targetingQualityValid,
      fieldQuality,
      languageValidation,
      targetingQualityValidation,
      metrics,
      diagnostic: {
        ...diagnostic,
        category: !schemaValid
          ? "invalid_ai_output"
          : !languageValidation.valid
            ? "output_language_mismatch"
            : "output_targeting_quality_insufficient",
      },
    };
}

export type ConfirmedTargetingLocation = {
  value: string;
  source_type: "public_observed" | "user_confirmed";
};

export function confirmedTargetingLocation(value: unknown, sourceType: unknown): ConfirmedTargetingLocation | null {
  const location = text(value, 500);
  if (!location || (sourceType !== "public_observed" && sourceType !== "user_confirmed")) return null;
  return { value: location, source_type: sourceType };
}

export type ConfirmedTargetingCriteria = {
  niche: string | null;
  suggested_category: string | null;
  probable_audience: string | null;
  themes: string[];
  keywords: string[];
  exclusions: string[];
  language: string | null;
  confirmed_location: ConfirmedTargetingLocation | null;
  business_description: string | null;
};
