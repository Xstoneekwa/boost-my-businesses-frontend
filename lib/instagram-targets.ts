import {
  isPlausibleInstagramPublicUsername,
  lookupInstagramPublicProfile,
  normalizeInstagramPublicUsername,
  safeInstagramPublicAvatarUrl,
  safeInstagramPublicMetadata,
  type InstagramPublicProfileLookupOptions,
  type InstagramPublicProfileLookupResult,
} from "./instagram-public-profile-lookup.ts";
import {
  evaluateTargetQuality,
  safeTargetQualityReason,
  type TargetQualityDecision,
  type TargetQualityStatus,
  type TargetStatus,
  type TargetVerificationStatus,
} from "./instagram-target-quality.ts";

export type {
  TargetQualityDecision,
  TargetQualityStatus,
  TargetStatus,
  TargetVerificationStatus,
};

export type TargetSource = "manual_single" | "manual_bulk" | "admin" | "client" | "future_discovery";
export type TargetActorType = "admin" | "client" | "system";

export type TargetVerificationDecision = TargetQualityDecision;

export type BulkTargetLineStatus =
  | "queued"
  | "pending_verification"
  | "invalid_syntax"
  | "duplicate_in_batch"
  | "duplicate_existing";

export type BulkTargetLine = {
  input_username: string;
  normalized_username: string;
  line_number: number;
  status: BulkTargetLineStatus;
  reason: string;
};

export type BulkTargetSummary = {
  total_submitted: number;
  accepted_for_verification: number;
  invalid: number;
  duplicates: number;
  already_existing: number;
};

export function normalizeTargetUsername(value: string) {
  return normalizeInstagramPublicUsername(value);
}

export function isValidTargetUsername(username: string) {
  return isPlausibleInstagramPublicUsername(username);
}

export function pendingTargetVerificationDecision(reason = "verification_pending"): TargetVerificationDecision {
  return evaluateTargetQuality({
    verification_status: "pending",
    provider_error_reason: safeTargetQualityReason(reason, "verification_pending"),
  });
}

export function targetDecisionFromLookup(lookup: InstagramPublicProfileLookupResult): TargetVerificationDecision {
  const metadata_safe = safeInstagramPublicMetadata({
    provider_status: lookup.status,
    reason: lookup.reason,
    cache_hit: lookup.metadata.cache_hit ?? null,
    throttle_hit: lookup.metadata.throttle_hit ?? null,
    rate_limited: lookup.metadata.rate_limited ?? null,
    latency_ms: lookup.metadata.latency_ms ?? null,
  });

  return evaluateTargetQuality({
    verification_status: lookup.status,
    provider_status: lookup.status,
    normalized_username: lookup.input_username,
    canonical_username: lookup.canonical_username || lookup.input_username,
    instagram_user_id: lookup.instagram_user_id,
    external_profile_id: lookup.external_profile_id,
    avatar_url: safeInstagramPublicAvatarUrl(lookup.avatar_url),
    followers_count: lookup.followers_count,
    is_verified: lookup.is_verified,
    is_private: lookup.is_private,
    provider_checked_at: lookup.checked_at,
    metadata_safe,
    provider_error_reason: lookup.reason || lookup.status,
  });
}

export async function verifySingleTargetUsername(username: string, options?: InstagramPublicProfileLookupOptions) {
  const lookup = await lookupInstagramPublicProfile(username, options);
  if (lookup.status === "username_invalid") {
    return evaluateTargetQuality({
      verification_status: "username_invalid",
      normalized_username: username,
      provider_checked_at: lookup.checked_at,
      provider_error_reason: "username_invalid",
      metadata_safe: safeInstagramPublicMetadata({
        provider_status: lookup.status,
        reason: lookup.reason,
      }),
    });
  }
  return targetDecisionFromLookup(lookup);
}

export function classifyBulkTargetLines(lines: string[], existingUsernames: Iterable<string>) {
  const existing = new Set([...existingUsernames].map(normalizeTargetUsername).filter(Boolean));
  const seen = new Set<string>();
  const results: BulkTargetLine[] = [];

  lines.forEach((line, index) => {
    const input = line.trim();
    if (!input) return;
    const normalized = normalizeTargetUsername(input);
    if (!isValidTargetUsername(normalized)) {
      results.push({
        input_username: input.slice(0, 120),
        normalized_username: normalized.slice(0, 120),
        line_number: index + 1,
        status: "invalid_syntax",
        reason: "invalid_syntax",
      });
      return;
    }
    if (seen.has(normalized)) {
      results.push({
        input_username: input,
        normalized_username: normalized,
        line_number: index + 1,
        status: "duplicate_in_batch",
        reason: "duplicate_in_batch",
      });
      return;
    }
    seen.add(normalized);
    if (existing.has(normalized)) {
      results.push({
        input_username: input,
        normalized_username: normalized,
        line_number: index + 1,
        status: "duplicate_existing",
        reason: "duplicate_existing",
      });
      return;
    }
    results.push({
      input_username: input,
      normalized_username: normalized,
      line_number: index + 1,
      status: "pending_verification",
      reason: "queued_for_future_verification",
    });
  });

  return results;
}

export function summarizeBulkTargetLines(lines: BulkTargetLine[]): BulkTargetSummary {
  return {
    total_submitted: lines.length,
    accepted_for_verification: lines.filter((line) => line.status === "pending_verification" || line.status === "queued").length,
    invalid: lines.filter((line) => line.status === "invalid_syntax").length,
    duplicates: lines.filter((line) => line.status === "duplicate_in_batch").length,
    already_existing: lines.filter((line) => line.status === "duplicate_existing").length,
  };
}
