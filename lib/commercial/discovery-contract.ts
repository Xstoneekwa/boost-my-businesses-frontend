export const COMMERCIAL_DISCOVERY_CITIES = ["Johannesburg", "Cape Town"] as const;
export const COMMERCIAL_DISCOVERY_SUBSEGMENTS = [
  "Aesthetic Clinic", "Skin Clinic", "Med Spa", "Beauty Salon", "Hair Salon",
  "Hair Stylist", "Nail Studio", "Lash Studio", "Brow Studio", "Laser Clinic",
  "Makeup Artist", "Wellness Studio",
] as const;

export const COMMERCIAL_DISCOVERY_MAX_PROSPECTS = 30;
export const COMMERCIAL_DISCOVERY_CANARY_MAX = 3;
export const COMMERCIAL_SCORING_MODEL_VERSION = "BMB_SCORING_MODEL_V2";
export const COMMERCIAL_AI_PROMPT_VERSION = "BMB_COMMERCIAL_AI_V2";
export const COMMERCIAL_AI_FORMAT_NAME = "bmb_commercial_analysis_v1";

export type CommercialDiscoveryCity = (typeof COMMERCIAL_DISCOVERY_CITIES)[number];
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
  if (!isOneOf(row.city, COMMERCIAL_DISCOVERY_CITIES)) throw new Error("commercial_discovery_city_invalid");
  if (row.subsegment !== undefined && row.subsegment !== "" && !isOneOf(row.subsegment, COMMERCIAL_DISCOVERY_SUBSEGMENTS)) {
    throw new Error("commercial_discovery_subsegment_invalid");
  }
  const maxProspects = Number(row.maxProspects);
  if (!Number.isInteger(maxProspects) || maxProspects < 1 || maxProspects > COMMERCIAL_DISCOVERY_MAX_PROSPECTS) {
    throw new Error("commercial_discovery_max_invalid");
  }
  const idempotencyKey = typeof row.idempotencyKey === "string" ? row.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("commercial_discovery_idempotency_invalid");
  if (row.forceRescore !== undefined && typeof row.forceRescore !== "boolean") throw new Error("commercial_discovery_force_rescore_invalid");
  return { city: row.city, ...(row.subsegment ? { subsegment: row.subsegment as CommercialDiscoverySubsegment } : {}), maxProspects, idempotencyKey, forceRescore: row.forceRescore === true };
}
