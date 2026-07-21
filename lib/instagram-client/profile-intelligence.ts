import type { ClientPublicProfileProjection } from "./create-account.ts";
import { detectProfileLanguage } from "./profile-language.ts";
import {
  readStoredProfileAiAnalysis,
  type ProfileAiConfidence,
  type ProfileAiConfirmedValues,
  type ProfileAiFieldQualityMap,
  type ProfileAiSuggestions,
  type StoredProfileAiAnalysis,
} from "./profile-intelligence-ai.ts";

export type ProfileSourceType =
  | "public_observed"
  | "deterministic_derived"
  | "ai_suggested"
  | "user_confirmed"
  | "unknown";

export type ProfileFieldEnvelope<T = unknown> = {
  value: T | null;
  source_type: ProfileSourceType;
  source_field: string | null;
  source_provider: string | null;
  confidence: number | null;
  observed_at: string | null;
  confirmed_at: string | null;
};

export type PublicProfileBioLink = { title: string | null; url: string };

export type ProfileIntelligenceField =
  | "providerProfileId"
  | "username"
  | "displayName"
  | "biography"
  | "avatarUrl"
  | "avatarHdUrl"
  | "followersCount"
  | "followingCount"
  | "postsCount"
  | "isPrivate"
  | "isVerified"
  | "isBusiness"
  | "officialCategory"
  | "externalUrl"
  | "bioLinks"
  | "recentCaptionSamples"
  | "language"
  | "location"
  | "niche"
  | "themes"
  | "probableAudience"
  | "suggestedCategory"
  | "businessDescription"
  | "keywords"
  | "exclusions";

export type StoredPublicAnalysisV1 = {
  version: 1;
  lookupStatus: string;
  username: string;
  displayName: string | null;
  biography: string | null;
  avatarUrl: string | null;
  avatarHdUrl: string | null;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  isBusiness: boolean | null;
  category: string | null;
  externalUrl: string | null;
  bioLinks: PublicProfileBioLink[];
  checkedAt: string;
  language: string | null;
  location: string | null;
  niche: string | null;
  themes: string[];
  probableAudience: string | null;
  suggestedCategory: string | null;
  businessDescription: string | null;
  keywords: string[];
  exclusions: string[];
  recentCaptionSamples: string[];
  sources: Record<string, ProfileSourceType>;
  fields: Record<ProfileIntelligenceField, ProfileFieldEnvelope>;
  confirmations: Partial<Record<ProfileIntelligenceField, ProfileFieldEnvelope>>;
  reanalysis?: {
    request_key: string;
    status: "running" | "completed" | "failed";
    started_at: string;
    completed_at: string | null;
    error_code: string | null;
  };
  ai_analysis?: StoredProfileAiAnalysis;
};

export type ClientPublicAnalysis = {
  version: 1;
  lookupStatus: string;
  username: string;
  displayName: string | null;
  biography: string | null;
  avatarAvailable: boolean;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  isPrivate: boolean | null;
  isVerified: boolean | null;
  isBusiness: boolean | null;
  category: string | null;
  externalUrl: string | null;
  bioLinks: PublicProfileBioLink[];
  checkedAt: string;
  language: string | null;
  location: string | null;
  niche: string | null;
  themes: string[];
  probableAudience: string | null;
  suggestedCategory: string | null;
  businessDescription: string | null;
  keywords: string[];
  exclusions: string[];
  recentCaptionSampleCount: number;
  sources: Record<string, ProfileSourceType>;
  aiAnalysis: {
    status: StoredProfileAiAnalysis["status"];
    requestedAt: string | null;
    completedAt: string | null;
    errorCode: string | null;
    confirmationStatus: StoredProfileAiAnalysis["confirmation_status"];
    confirmedAt: string | null;
    fieldQuality: ProfileAiFieldQualityMap | null;
    targetingQualityValid: boolean | null;
  };
};

type UnknownRecord = Record<string, unknown>;

const editableFields = [
  "displayName",
  "biography",
  "officialCategory",
  "language",
  "location",
  "niche",
  "themes",
  "probableAudience",
] as const satisfies readonly ProfileIntelligenceField[];

const aiEditableFields = [
  "suggestedCategory",
  "niche",
  "probableAudience",
  "themes",
  "businessDescription",
  "keywords",
  "exclusions",
] as const satisfies readonly ProfileIntelligenceField[];

const aiSuggestionField = {
  suggestedCategory: "suggested_category",
  niche: "niche",
  probableAudience: "probable_audience",
  themes: "themes",
  businessDescription: "business_description",
  keywords: "keywords",
  exclusions: "exclusions",
} as const satisfies Record<typeof aiEditableFields[number], keyof ProfileAiSuggestions>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, limit = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().slice(0, limit);
  return normalized || null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringList(value: unknown, limit = 12, itemLimit = 280) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, itemLimit)).filter((item): item is string => Boolean(item)))].slice(0, limit);
}

function bioLinks(value: unknown): PublicProfileBioLink[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((item) => {
    const row = record(item);
    const url = text(row.url, 2048);
    if (!url) return [];
    return [{ title: text(row.title, 120), url }];
  });
}

function observed<T>(value: T | null, sourceField: string, observedAt: string): ProfileFieldEnvelope<T> {
  return {
    value,
    source_type: value === null || (Array.isArray(value) && value.length === 0) ? "unknown" : "public_observed",
    source_field: value === null || (Array.isArray(value) && value.length === 0) ? null : sourceField,
    source_provider: value === null || (Array.isArray(value) && value.length === 0) ? null : "searchapi",
    confidence: value === null || (Array.isArray(value) && value.length === 0) ? null : 1,
    observed_at: value === null || (Array.isArray(value) && value.length === 0) ? null : observedAt,
    confirmed_at: null,
  };
}

function unknownEnvelope<T>(): ProfileFieldEnvelope<T> {
  return {
    value: null,
    source_type: "unknown",
    source_field: null,
    source_provider: null,
    confidence: null,
    observed_at: null,
    confirmed_at: null,
  };
}

function confirmation<T>(value: T | null, field: string, confirmedAt: string): ProfileFieldEnvelope<T> {
  return {
    value,
    source_type: "user_confirmed",
    source_field: field,
    source_provider: null,
    confidence: 1,
    observed_at: null,
    confirmed_at: confirmedAt,
  };
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function confidenceNumber(value: ProfileAiConfidence) {
  return value === "high" ? 0.9 : value === "medium" ? 0.65 : 0.35;
}

function aiSuggestionEnvelope(
  stored: StoredPublicAnalysisV1,
  field: ProfileIntelligenceField,
): ProfileFieldEnvelope | null {
  if (!stored.ai_analysis?.suggestions || !(field in aiSuggestionField)) return null;
  const key = aiSuggestionField[field as keyof typeof aiSuggestionField];
  const suggestion = stored.ai_analysis.suggestions[key];
  return {
    value: suggestion.value,
    source_type: "ai_suggested",
    source_field: suggestion.evidence_fields.join(",") || null,
    source_provider: "openai",
    confidence: confidenceNumber(suggestion.confidence),
    observed_at: stored.ai_analysis.completed_at,
    confirmed_at: null,
  };
}

function effectiveEnvelope(
  stored: StoredPublicAnalysisV1,
  field: ProfileIntelligenceField,
) {
  return stored.confirmations[field] ?? aiSuggestionEnvelope(stored, field) ?? stored.fields[field];
}

function rebuildCompatibilityFields(stored: StoredPublicAnalysisV1): StoredPublicAnalysisV1 {
  const value = (field: ProfileIntelligenceField) => effectiveEnvelope(stored, field)?.value;
  const sources = Object.fromEntries(
    (Object.keys(stored.fields) as ProfileIntelligenceField[]).map((field) => [
      field === "officialCategory" ? "category" : field,
      effectiveEnvelope(stored, field)?.source_type ?? "unknown",
    ]),
  );
  return {
    ...stored,
    username: text(value("username"), 30) ?? "",
    displayName: text(value("displayName"), 500),
    biography: text(value("biography"), 2000),
    avatarUrl: text(stored.fields.avatarUrl.value, 2048),
    avatarHdUrl: text(stored.fields.avatarHdUrl.value, 2048),
    followersCount: numberOrNull(value("followersCount")),
    followingCount: numberOrNull(value("followingCount")),
    postsCount: numberOrNull(value("postsCount")),
    isPrivate: booleanOrNull(value("isPrivate")),
    isVerified: booleanOrNull(value("isVerified")),
    isBusiness: booleanOrNull(value("isBusiness")),
    category: text(value("officialCategory"), 500),
    externalUrl: text(value("externalUrl"), 2048),
    bioLinks: bioLinks(value("bioLinks")),
    language: text(value("language"), 80),
    location: text(value("location"), 500),
    niche: text(value("niche"), 500),
    themes: stringList(value("themes"), 12, 80),
    probableAudience: text(value("probableAudience"), 500),
    suggestedCategory: text(value("suggestedCategory"), 500),
    businessDescription: text(value("businessDescription"), 1_000),
    keywords: stringList(value("keywords"), 20, 80),
    exclusions: stringList(value("exclusions"), 20, 80),
    recentCaptionSamples: stringList(stored.fields.recentCaptionSamples.value, 5, 280),
    sources,
  };
}

export function buildStoredPublicAnalysis(profile: ClientPublicProfileProjection): StoredPublicAnalysisV1 {
  const observedAt = profile.checkedAt || new Date().toISOString();
  const language = detectProfileLanguage({
    biography: profile.biography,
    displayName: profile.displayName,
    captions: profile.recentCaptionSamples,
  });
  const fields = {
    providerProfileId: observed(profile.providerProfileId, "profile.id", observedAt),
    username: observed(profile.username, "profile.username", observedAt),
    displayName: observed(profile.displayName, "profile.name", observedAt),
    biography: observed(profile.biography, "profile.bio", observedAt),
    avatarUrl: observed(profile.avatarUrl, "profile.avatar", observedAt),
    avatarHdUrl: observed(profile.avatarHdUrl, "profile.avatar_hd", observedAt),
    followersCount: observed(profile.followersCount, "profile.followers", observedAt),
    followingCount: observed(profile.followingCount, "profile.following", observedAt),
    postsCount: observed(profile.postsCount, "profile.posts", observedAt),
    isPrivate: observed(profile.isPrivate, "profile.is_private", observedAt),
    isVerified: observed(profile.isVerified, "profile.is_verified", observedAt),
    isBusiness: observed(profile.isBusiness, "profile.is_business", observedAt),
    officialCategory: observed(profile.officialCategory, "profile.category", observedAt),
    externalUrl: observed(profile.externalUrl, "profile.external_link", observedAt),
    bioLinks: observed(profile.bioLinks, "profile.bio_links", observedAt),
    recentCaptionSamples: observed(profile.recentCaptionSamples, "posts[].caption", observedAt),
    language: language.language ? {
      value: language.language,
      source_type: "deterministic_derived" as const,
      source_field: language.sourceFields.join(","),
      source_provider: null,
      confidence: language.confidence,
      observed_at: observedAt,
      confirmed_at: null,
    } : unknownEnvelope<string>(),
    location: unknownEnvelope<string>(),
    niche: unknownEnvelope<string>(),
    themes: unknownEnvelope<string[]>(),
    probableAudience: unknownEnvelope<string>(),
    suggestedCategory: unknownEnvelope<string>(),
    businessDescription: unknownEnvelope<string>(),
    keywords: unknownEnvelope<string[]>(),
    exclusions: unknownEnvelope<string[]>(),
  } satisfies Record<ProfileIntelligenceField, ProfileFieldEnvelope>;

  return rebuildCompatibilityFields({
    version: 1,
    lookupStatus: profile.lookupStatus,
    username: profile.username,
    displayName: profile.displayName,
    biography: profile.biography,
    avatarUrl: profile.avatarUrl,
    avatarHdUrl: profile.avatarHdUrl,
    followersCount: profile.followersCount,
    followingCount: profile.followingCount,
    postsCount: profile.postsCount,
    isPrivate: profile.isPrivate,
    isVerified: profile.isVerified,
    isBusiness: profile.isBusiness,
    category: profile.officialCategory,
    externalUrl: profile.externalUrl,
    bioLinks: profile.bioLinks,
    checkedAt: observedAt,
    language: language.language,
    location: null,
    niche: null,
    themes: [],
    probableAudience: null,
    suggestedCategory: null,
    businessDescription: null,
    keywords: [],
    exclusions: [],
    recentCaptionSamples: profile.recentCaptionSamples,
    sources: {},
    fields,
    confirmations: {},
  });
}

function legacyProfile(row: UnknownRecord): ClientPublicProfileProjection | null {
  const username = text(row.username, 30);
  if (!username) return null;
  return {
    lookupStatus: text(row.lookupStatus, 120) ?? "unknown",
    providerProfileId: text(row.providerProfileId, 160),
    username,
    displayName: text(row.displayName, 500),
    biography: text(row.biography, 2000),
    avatarUrl: text(row.avatarUrl, 2048),
    avatarHdUrl: text(row.avatarHdUrl, 2048),
    followersCount: numberOrNull(row.followersCount),
    followingCount: numberOrNull(row.followingCount),
    postsCount: numberOrNull(row.postsCount),
    isPrivate: booleanOrNull(row.isPrivate),
    isVerified: booleanOrNull(row.isVerified),
    isBusiness: booleanOrNull(row.isBusiness),
    officialCategory: text(row.category, 500),
    externalUrl: text(row.externalUrl, 2048),
    bioLinks: bioLinks(row.bioLinks),
    recentCaptionSamples: stringList(row.recentCaptionSamples, 5, 280),
    checkedAt: text(row.checkedAt, 80) ?? new Date(0).toISOString(),
  };
}

function sanitizeEnvelope(value: unknown, fallback: ProfileFieldEnvelope): ProfileFieldEnvelope {
  const row = record(value);
  const sourceType = row.source_type;
  return {
    value: Object.prototype.hasOwnProperty.call(row, "value") ? row.value : fallback.value,
    source_type: sourceType === "public_observed" || sourceType === "deterministic_derived" || sourceType === "ai_suggested" || sourceType === "user_confirmed" || sourceType === "unknown"
      ? sourceType
      : fallback.source_type,
    source_field: text(row.source_field, 160),
    source_provider: text(row.source_provider, 80),
    confidence: typeof row.confidence === "number" && row.confidence >= 0 && row.confidence <= 1 ? row.confidence : null,
    observed_at: text(row.observed_at, 80),
    confirmed_at: text(row.confirmed_at, 80),
  };
}

export function readStoredPublicAnalysis(value: unknown): StoredPublicAnalysisV1 | null {
  const row = record(value);
  const legacy = legacyProfile(row);
  if (!legacy) return null;
  const fallback = buildStoredPublicAnalysis(legacy);
  if (row.version !== 1 || !row.fields || typeof row.fields !== "object") return fallback;

  const fieldRows = record(row.fields);
  const confirmationRows = record(row.confirmations);
  const fields = { ...fallback.fields };
  const confirmations: Partial<Record<ProfileIntelligenceField, ProfileFieldEnvelope>> = {};
  for (const field of Object.keys(fields) as ProfileIntelligenceField[]) {
    fields[field] = sanitizeEnvelope(fieldRows[field], fields[field]);
    if (confirmationRows[field]) confirmations[field] = sanitizeEnvelope(confirmationRows[field], fields[field]);
  }
  const reanalysisRow = record(row.reanalysis);
  const reanalysisStatus = reanalysisRow.status;
  const reanalysis: StoredPublicAnalysisV1["reanalysis"] = text(reanalysisRow.request_key, 80) && (reanalysisStatus === "running" || reanalysisStatus === "completed" || reanalysisStatus === "failed")
    ? {
      request_key: text(reanalysisRow.request_key, 80)!,
      status: reanalysisStatus,
      started_at: text(reanalysisRow.started_at, 80) ?? fallback.checkedAt,
      completed_at: text(reanalysisRow.completed_at, 80),
      error_code: text(reanalysisRow.error_code, 120),
    }
    : undefined;
  const aiAnalysisRow = record(row.ai_analysis);
  const aiAnalysis = Object.keys(aiAnalysisRow).length ? readStoredProfileAiAnalysis(aiAnalysisRow) : undefined;

  return rebuildCompatibilityFields({
    ...fallback,
    lookupStatus: text(row.lookupStatus, 120) ?? fallback.lookupStatus,
    checkedAt: text(row.checkedAt, 80) ?? fallback.checkedAt,
    recentCaptionSamples: stringList(row.recentCaptionSamples, 5, 280),
    fields,
    confirmations,
    ...(reanalysis ? { reanalysis } : {}),
    ...(aiAnalysis ? { ai_analysis: aiAnalysis } : {}),
  });
}

export function projectClientPublicAnalysis(value: unknown): ClientPublicAnalysis | null {
  const stored = readStoredPublicAnalysis(value);
  if (!stored) return null;
  const aiAnalysis = readStoredProfileAiAnalysis(stored.ai_analysis);
  return {
    version: 1,
    lookupStatus: stored.lookupStatus,
    username: stored.username,
    displayName: stored.displayName,
    biography: stored.biography,
    avatarAvailable: Boolean(stored.avatarUrl || stored.avatarHdUrl),
    followersCount: stored.followersCount,
    followingCount: stored.followingCount,
    postsCount: stored.postsCount,
    isPrivate: stored.isPrivate,
    isVerified: stored.isVerified,
    isBusiness: stored.isBusiness,
    category: stored.category,
    externalUrl: stored.externalUrl,
    bioLinks: stored.bioLinks,
    checkedAt: stored.checkedAt,
    language: stored.language,
    location: stored.location,
    niche: stored.niche,
    themes: stored.themes,
    probableAudience: stored.probableAudience,
    suggestedCategory: stored.suggestedCategory,
    businessDescription: stored.businessDescription,
    keywords: stored.keywords,
    exclusions: stored.exclusions,
    recentCaptionSampleCount: stored.recentCaptionSamples.length,
    sources: { ...stored.sources },
    aiAnalysis: {
      status: aiAnalysis.status,
      requestedAt: aiAnalysis.requested_at,
      completedAt: aiAnalysis.completed_at,
      errorCode: aiAnalysis.error_code,
      confirmationStatus: aiAnalysis.confirmation_status,
      confirmedAt: aiAnalysis.confirmed_at,
      fieldQuality: aiAnalysis.field_quality,
      targetingQualityValid: aiAnalysis.targeting_quality_valid,
    },
  };
}

function clientEditableValue(row: UnknownRecord, field: ProfileIntelligenceField) {
  if (field === "officialCategory") return text(row.category, 500);
  if (field === "themes" || field === "keywords" || field === "exclusions") {
    return stringList(row[field], field === "themes" ? 8 : 20, 80);
  }
  return text(row[field], field === "biography" ? 2000 : field === "businessDescription" ? 1_000 : 500);
}

function confirmedAiValues(
  stored: StoredPublicAnalysisV1,
  confirmations: Partial<Record<ProfileIntelligenceField, ProfileFieldEnvelope>>,
): ProfileAiConfirmedValues | null {
  if (!stored.ai_analysis?.suggestions && !stored.ai_analysis?.field_quality) return null;
  const value = (field: typeof aiEditableFields[number]) => confirmations[field]?.value
    ?? aiSuggestionEnvelope(stored, field)?.value
    ?? null;
  return {
    suggested_category: text(value("suggestedCategory"), 500),
    niche: text(value("niche"), 500),
    probable_audience: text(value("probableAudience"), 500),
    themes: stringList(value("themes"), 8, 80),
    business_description: text(value("businessDescription"), 1_000),
    keywords: stringList(value("keywords"), 20, 80),
    exclusions: stringList(value("exclusions"), 20, 80),
  };
}

export function applyClientPublicAnalysisConfirmation(
  value: unknown,
  baseValue: unknown,
  confirmedAt = new Date().toISOString(),
) {
  const base = readStoredPublicAnalysis(baseValue);
  if (!base) throw new Error("public_analysis_required");
  const row = record(value);
  const confirmations = { ...base.confirmations };
  const confirmingAiSuggestions = Boolean(base.ai_analysis?.suggestions || base.ai_analysis?.field_quality);
  const fieldsToConfirm = confirmingAiSuggestions ? aiEditableFields : editableFields;
  for (const field of fieldsToConfirm) {
    const clientField = field === "officialCategory" ? "category" : field;
    if (!Object.prototype.hasOwnProperty.call(row, clientField)) continue;
    const next = clientEditableValue(row, field);
    if (confirmingAiSuggestions) {
      confirmations[field] = confirmation(next, field, confirmedAt);
      continue;
    }
    const observedValue = base.fields[field].value;
    if (sameValue(next, observedValue) || (field === "themes" && Array.isArray(next) && next.length === 0 && Array.isArray(observedValue) && observedValue.length === 0)) {
      delete confirmations[field];
      continue;
    }
    if (next === null && (observedValue === null || (Array.isArray(observedValue) && observedValue.length === 0))) {
      delete confirmations[field];
      continue;
    }
    confirmations[field] = confirmation(next, field, confirmedAt);
  }
  const confirmedValues = confirmedAiValues(base, confirmations);
  const aiAnalysis = base.ai_analysis && confirmedValues ? {
    ...base.ai_analysis,
    confirmation_status: "confirmed" as const,
    confirmed_at: confirmedAt,
    confirmed_values: confirmedValues,
  } : base.ai_analysis;
  return rebuildCompatibilityFields({ ...base, confirmations, ...(aiAnalysis ? { ai_analysis: aiAnalysis } : {}) });
}

export function mergeReanalysisPreservingConfirmations(
  fresh: StoredPublicAnalysisV1,
  previousValue: unknown,
) {
  const previous = readStoredPublicAnalysis(previousValue);
  return rebuildCompatibilityFields({
    ...fresh,
    confirmations: previous?.confirmations ?? {},
    ...(previous?.ai_analysis ? { ai_analysis: previous.ai_analysis } : {}),
  });
}

export function withProfileAiAnalysis(value: unknown, aiAnalysis: StoredProfileAiAnalysis) {
  const stored = readStoredPublicAnalysis(value);
  if (!stored) throw new Error("public_analysis_required");
  return rebuildCompatibilityFields({ ...stored, ai_analysis: readStoredProfileAiAnalysis(aiAnalysis) });
}

export function withReanalysisState(
  value: unknown,
  reanalysis: StoredPublicAnalysisV1["reanalysis"],
) {
  const stored = readStoredPublicAnalysis(value);
  if (!stored) throw new Error("public_analysis_required");
  return rebuildCompatibilityFields({ ...stored, ...(reanalysis ? { reanalysis } : {}) });
}

export function onboardingAvatarSource(value: unknown) {
  const stored = readStoredPublicAnalysis(value);
  if (!stored) return null;
  return {
    username: stored.username,
    avatarUrl: stored.avatarHdUrl || stored.avatarUrl,
  };
}
