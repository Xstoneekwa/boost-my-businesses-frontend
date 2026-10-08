export const COMMERCIAL_DISCOVERY_CITIES = ["Johannesburg", "Cape Town"] as const;
export const COMMERCIAL_DISCOVERY_SUBSEGMENTS = [
  "Aesthetic Clinic", "Skin Clinic", "Med Spa", "Beauty Salon", "Hair Salon",
  "Hair Stylist", "Nail Studio", "Lash Studio", "Brow Studio", "Laser Clinic",
  "Makeup Artist", "Wellness Studio",
] as const;

export const COMMERCIAL_DISCOVERY_MAX_PROSPECTS = 30;
export const COMMERCIAL_FRANCE_CANARY_MAX_PROSPECTS = 50;
export const COMMERCIAL_FRANCE_CANARY_VOLUMES = [10, 30, 50] as const;
export const COMMERCIAL_DISCOVERY_CANARY_MAX = 3;
export const COMMERCIAL_SCORING_MODEL_VERSION = "BMB_SCORING_MODEL_V2";
export const COMMERCIAL_AI_PROMPT_VERSION = "BMB_COMMERCIAL_AI_V2";
export const COMMERCIAL_AI_FORMAT_NAME = "bmb_commercial_analysis_v1";

// France is a nationwide run scope, never the detected business city.
// City is data supplied by the run. The ZA UI keeps its historical allow-list,
// while France can accept any owner-approved city without a code change.
export type CommercialDiscoveryCity = string;
export type CommercialDiscoveryCountry = "ZA" | "FR";
export type CommercialDiscoverySubsegment = (typeof COMMERCIAL_DISCOVERY_SUBSEGMENTS)[number];
export type CommercialScoreDimension =
  | "instagramImportance" | "contentQuality" | "activity" | "commercialStrength"
  | "customerValue" | "targetingFit" | "growthPotential" | "decisionMakerAccess" | "budgetFit";

export const COMMERCIAL_SCORE_WEIGHTS: Record<CommercialScoreDimension, number> = {
  instagramImportance: 0.15,
  contentQuality: 0.10,
  activity: 0.10,
  commercialStrength: 0.10,
  customerValue: 0.10,
  targetingFit: 0.15,
  growthPotential: 0.10,
  decisionMakerAccess: 0.10,
  budgetFit: 0.10,
};

export type CommercialAiAnalysis = {
  businessName: string;
  subsegment: CommercialDiscoverySubsegment;
  locationConfidence: number;
  verticalConfidence: number;
  confidence: number;
  dimensions: Record<CommercialScoreDimension, number>;
  evidence: string[];
  reasoning: string;
  recommendedChannel: "instagram" | "email";
  recommendedAngle: "A" | "B";
  signals: {
    isLocal: boolean;
    isBeautyAesthetics: boolean;
    isCommerciallyActive: boolean;
    appearsClosed: boolean;
  };
};

export type CommercialDiscoveryTrigger = {
  countryCode?: CommercialDiscoveryCountry;
  city: CommercialDiscoveryCity;
  subsegment?: CommercialDiscoverySubsegment;
  maxProspects: number;
  idempotencyKey: string;
  forceRescore: boolean;
};

export type CommercialDiscoveryRunStatus = "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "cancelled";
export type CommercialDiscoveryRun = {
  id: string;
  city: CommercialDiscoveryCity;
  subsegment: CommercialDiscoverySubsegment | null;
  maxProspects: number;
  status: CommercialDiscoveryRunStatus;
  discoveredCount: number;
  createdCount: number;
  duplicateCount: number;
  enrichedCount: number;
  scoredCount: number;
  qualifiedCount: number;
  p1Count: number;
  p2Count: number;
  p3Count: number;
  hardRejectedCount: number;
  precheckRejectedCount: number;
  aiPendingCount: number;
  errorCount: number;
  elapsedMs: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type CommercialDiscoveryReadModel = {
  latest: CommercialDiscoveryRun[];
  summary: { lastRunAt: string | null; running: number; discovered: number; enriched: number; scored: number; p1: number; p2: number };
};

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && allowed.includes(value as T[number]);
}

export function parseCommercialDiscoveryTrigger(value: unknown): CommercialDiscoveryTrigger {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const countryCode = row.countryCode === undefined ? (row.city === "France" ? "FR" : "ZA") : row.countryCode;
  if (countryCode !== "ZA" && countryCode !== "FR") throw new Error("commercial_discovery_country_invalid");
  const city = typeof row.city === "string" ? row.city.trim() : "";
  if (!city || (countryCode === "ZA" && !isOneOf(city, COMMERCIAL_DISCOVERY_CITIES))) throw new Error("commercial_discovery_city_invalid");
  // The France UI disables subsegment selection, so FormData serializes it as
  // null for every owner-supplied city. Treat that as the explicit absence of
  // a subsegment for France while preserving the stricter ZA contract.
  if (row.subsegment !== undefined && row.subsegment !== "" && !(countryCode === "FR" && row.subsegment === null) && !isOneOf(row.subsegment, COMMERCIAL_DISCOVERY_SUBSEGMENTS)) {
    throw new Error("commercial_discovery_subsegment_invalid");
  }
  const maxProspects = Number(row.maxProspects);
  const maxAllowed = countryCode === "FR" ? COMMERCIAL_FRANCE_CANARY_MAX_PROSPECTS : COMMERCIAL_DISCOVERY_MAX_PROSPECTS;
  // The initial France canary is three independent, idempotent city runs
  // (10 candidates each). Historical `city=France` runs retain their
  // original 30-candidate contract for backward compatibility.
  const minAllowed = countryCode === "FR" ? (city === "France" ? 30 : 10) : 1;
  if (!Number.isInteger(maxProspects) || maxProspects < minAllowed || maxProspects > maxAllowed) {
    throw new Error("commercial_discovery_max_invalid");
  }
  const idempotencyKey = typeof row.idempotencyKey === "string" ? row.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("commercial_discovery_idempotency_invalid");
  if (row.forceRescore !== undefined && typeof row.forceRescore !== "boolean") throw new Error("commercial_discovery_force_rescore_invalid");
  if (countryCode === "FR" && city === "France" && (maxProspects !== 30 || row.forceRescore === true || row.subsegment)) throw new Error("commercial_france_canary_scope_invalid");
  return { countryCode, city, ...(row.subsegment ? { subsegment: row.subsegment as CommercialDiscoverySubsegment } : {}), maxProspects, idempotencyKey, forceRescore: row.forceRescore === true };
}
