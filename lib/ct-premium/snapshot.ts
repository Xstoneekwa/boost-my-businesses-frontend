import type { AccountId, CtIdGenerator, CtPlan, CtTargetPerformance, CtTargetingCriteriaSnapshot, SnapshotId, TenantId } from "./types.ts";
import { CT_PREMIUM_PRODUCT_CONFIG } from "./config.ts";

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
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

export interface CtSnapshotInput {
  tenantId: TenantId;
  accountId: AccountId;
  plan: CtPlan;
  accountLanguage: string;
  targetGeographies: readonly string[];
  targetLanguages: readonly string[];
  categories: readonly string[];
  followerRange: { min: number; max: number };
  engagementExpectation: number;
  accountAnalysis: Record<string, string | number | boolean | null>;
  activeTargetUsernames: readonly string[];
  historicalTargetPerformance: readonly CtTargetPerformance[];
  blacklistUsernames: readonly string[];
  rejectedCooldownDays?: number;
  scoringVersion: string;
  createdAt: string;
}

export function buildCriteriaSnapshot(input: CtSnapshotInput, ids: CtIdGenerator): CtTargetingCriteriaSnapshot {
  const fingerprintPayload = {
    ...input,
    targetGeographies: [...input.targetGeographies].sort(),
    targetLanguages: [...input.targetLanguages].sort(),
    categories: [...input.categories].sort(),
    activeTargetUsernames: [...input.activeTargetUsernames].sort(),
    blacklistUsernames: [...input.blacklistUsernames].sort(),
  };
  return Object.freeze({
    id: ids.next("snapshot") as SnapshotId,
    ...fingerprintPayload,
    followerRange: Object.freeze({ ...input.followerRange }),
    accountAnalysis: Object.freeze({ ...input.accountAnalysis }),
    targetGeographies: Object.freeze(fingerprintPayload.targetGeographies),
    targetLanguages: Object.freeze(fingerprintPayload.targetLanguages),
    categories: Object.freeze(fingerprintPayload.categories),
    activeTargetUsernames: Object.freeze(fingerprintPayload.activeTargetUsernames),
    historicalTargetPerformance: Object.freeze(input.historicalTargetPerformance.map((item) => Object.freeze({ ...item }))),
    blacklistUsernames: Object.freeze(fingerprintPayload.blacklistUsernames),
    reviewConfig: Object.freeze({ durationDays: CT_PREMIUM_PRODUCT_CONFIG.reviewDurationDays, rejectedCooldownDays: input.rejectedCooldownDays ?? CT_PREMIUM_PRODUCT_CONFIG.rejectionCooldownDays }),
    fingerprint: ctStableFingerprint(fingerprintPayload),
  });
}
