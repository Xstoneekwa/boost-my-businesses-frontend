import { CT_PREMIUM_PRODUCT_CONFIG } from "./config.ts";
import { normalizeInstagramUsername } from "./normalization.ts";
import type { AccountId, CtIdGenerator, CtPlan, CtTargetPerformance, CtTargetingCriteriaSnapshot, SnapshotId, TenantId } from "./types.ts";

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function ctStableFingerprint(value: unknown) {
  const input = canonicalize(value);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizedList(values: readonly string[], usernames = false) {
  const normalized = values.map((value) => {
    if (!usernames) return value.trim().toLowerCase();
    const result = normalizeInstagramUsername(value);
    return result.ok ? result.normalized : "";
  }).filter(Boolean);
  return [...new Set(normalized)].sort();
}

function sortedRecord<T>(input: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

export interface CtCanonicalSnapshotInput {
  tenantId: TenantId;
  accountId: AccountId;
  plan: CtPlan;
  entitlementIdentity: string;
  entitlementVersion: string;
  eligibleTargetCount: number;
  accountLanguage: string;
  targetGeographies: readonly string[];
  targetLanguages: readonly string[];
  categories: readonly string[];
  followerRange: { min: number; max: number };
  engagementExpectation: number;
  accountAnalysis: Record<string, string | number | boolean | null>;
  activeTargetUsernames: readonly string[];
  historicalTargetPerformance: readonly CtTargetPerformance[];
  sourceTargetPerformance: Readonly<Record<string, number>>;
  followbackSignals: Readonly<Record<string, number>>;
  skipEligibilitySignals: Readonly<Record<string, string | number | boolean | null>>;
  blacklistUsernames: readonly string[];
  rejectedCooldownDays?: number;
  scoringVersion: string;
  searchStrategyVersion: string;
  batchSize: number;
  triggerReason: string;
  createdAt: string;
}

export type CtSnapshotCompatibility = "identical" | "compatible" | "materially_changed" | "invalid";

export function buildCtTargetingCriteriaSnapshot(input: CtCanonicalSnapshotInput, ids: CtIdGenerator): CtTargetingCriteriaSnapshot {
  if (!input.tenantId || !input.accountId || !input.entitlementIdentity || !input.entitlementVersion) throw new Error("invalid_snapshot_scope");
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > CT_PREMIUM_PRODUCT_CONFIG.maxBatchSize) throw new Error("invalid_snapshot_batch_size");
  if (input.followerRange.min < 0 || input.followerRange.max < input.followerRange.min) throw new Error("invalid_snapshot_follower_range");
  if (!input.scoringVersion || !input.searchStrategyVersion) throw new Error("invalid_snapshot_version");

  const payload = {
    tenantId: input.tenantId,
    accountId: input.accountId,
    plan: input.plan,
    entitlementIdentity: input.entitlementIdentity,
    entitlementVersion: input.entitlementVersion,
    eligibleTargetCount: Math.max(0, Math.trunc(input.eligibleTargetCount)),
    accountLanguage: input.accountLanguage.trim().toLowerCase(),
    targetGeographies: normalizedList(input.targetGeographies),
    targetLanguages: normalizedList(input.targetLanguages),
    categories: normalizedList(input.categories),
    followerRange: { ...input.followerRange },
    engagementExpectation: input.engagementExpectation,
    accountAnalysis: sortedRecord(input.accountAnalysis),
    activeTargetUsernames: normalizedList(input.activeTargetUsernames, true),
    historicalTargetPerformance: [...input.historicalTargetPerformance].map((item) => ({ ...item, username: normalizedList([item.username], true)[0] ?? "" })).filter((item) => item.username).sort((a, b) => a.username.localeCompare(b.username)),
    sourceTargetPerformance: sortedRecord(input.sourceTargetPerformance),
    followbackSignals: sortedRecord(input.followbackSignals),
    skipEligibilitySignals: sortedRecord(input.skipEligibilitySignals),
    blacklistUsernames: normalizedList(input.blacklistUsernames, true),
    reviewConfig: { durationDays: CT_PREMIUM_PRODUCT_CONFIG.reviewDurationDays, rejectedCooldownDays: input.rejectedCooldownDays ?? CT_PREMIUM_PRODUCT_CONFIG.rejectionCooldownDays } as const,
    scoringVersion: input.scoringVersion,
    searchStrategyVersion: input.searchStrategyVersion,
    batchSize: input.batchSize,
    triggerReason: input.triggerReason,
  };
  return deepFreeze({ id: ids.next("snapshot") as SnapshotId, ...payload, createdAt: input.createdAt, fingerprint: ctStableFingerprint(payload) }) as CtTargetingCriteriaSnapshot;
}

export function compareSnapshotCompatibility(left: CtTargetingCriteriaSnapshot, right: CtTargetingCriteriaSnapshot): CtSnapshotCompatibility {
  if (!left?.tenantId || !right?.tenantId || !left?.accountId || !right?.accountId) return "invalid";
  if (left.tenantId !== right.tenantId || left.accountId !== right.accountId) return "invalid";
  if (left.fingerprint === right.fingerprint) return "identical";
  const compatibleKeys = new Set(["id", "createdAt", "fingerprint", "eligibleTargetCount", "historicalTargetPerformance", "sourceTargetPerformance", "followbackSignals", "skipEligibilitySignals"]);
  const strip = (value: CtTargetingCriteriaSnapshot) => Object.fromEntries(Object.entries(value).filter(([key]) => !compatibleKeys.has(key)));
  return canonicalize(strip(left)) === canonicalize(strip(right)) ? "compatible" : "materially_changed";
}

export type CtSnapshotInput = Omit<CtCanonicalSnapshotInput, "entitlementIdentity" | "entitlementVersion" | "eligibleTargetCount" | "sourceTargetPerformance" | "followbackSignals" | "skipEligibilitySignals" | "searchStrategyVersion" | "batchSize" | "triggerReason">;

export function buildCriteriaSnapshot(input: CtSnapshotInput, ids: CtIdGenerator): CtTargetingCriteriaSnapshot {
  return buildCtTargetingCriteriaSnapshot({
    ...input,
    entitlementIdentity: "entitlement_unspecified",
    entitlementVersion: "v1",
    eligibleTargetCount: input.activeTargetUsernames.length,
    sourceTargetPerformance: {},
    followbackSignals: {},
    skipEligibilitySignals: {},
    searchStrategyVersion: CT_PREMIUM_PRODUCT_CONFIG.searchStrategyVersion,
    batchSize: CT_PREMIUM_PRODUCT_CONFIG.defaultBatchSize,
    triggerReason: "legacy_builder",
  }, ids);
}
