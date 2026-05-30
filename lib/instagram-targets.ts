import {
  isPlausibleInstagramPublicUsername,
  lookupInstagramPublicProfile,
  normalizeInstagramPublicUsername,
  safeInstagramPublicAvatarUrl,
  safeInstagramPublicMetadata,
  type InstagramPublicProfileLookupOptions,
  type InstagramPublicProfileLookupResult,
} from "./instagram-public-profile-lookup.ts";

export type TargetStatus =
  | "pending_verification"
  | "valid"
  | "rejected"
  | "review"
  | "duplicate"
  | "archived";

export type TargetVerificationStatus =
  | "pending"
  | "found"
  | "not_found"
  | "unavailable"
  | "rate_limited"
  | "provider_error";

export type TargetQualityStatus =
  | "unknown"
  | "eligible"
  | "rejected_low_followers"
  | "rejected_verified"
  | "rejected_private"
  | "rejected_not_found"
  | "review_provider_unavailable"
  | "review_username_changed";

export type TargetSource = "manual_single" | "manual_bulk" | "admin" | "client" | "future_discovery";
export type TargetActorType = "admin" | "client" | "system";

export type TargetVerificationDecision = {
  status: TargetStatus;
  verification_status: TargetVerificationStatus;
  verification_reason: string;
  quality_status: TargetQualityStatus;
  canonical_username: string | null;
  avatar_url: string | null;
  followers_count: number | null;
  is_verified: boolean | null;
  is_private: boolean | null;
  provider_checked_at: string | null;
  rejected_reason: string | null;
  metadata_safe: Record<string, string | number | boolean | null>;
};

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

function safeReason(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_:-]/g, "_").slice(0, 120) || "unknown";
}

export function pendingTargetVerificationDecision(reason = "verification_pending"): TargetVerificationDecision {
  return {
    status: "pending_verification",
    verification_status: "pending",
    verification_reason: safeReason(reason),
    quality_status: "unknown",
    canonical_username: null,
    avatar_url: null,
    followers_count: null,
    is_verified: null,
    is_private: null,
    provider_checked_at: null,
    rejected_reason: null,
    metadata_safe: {},
  };
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

  if (lookup.status === "found") {
    const canonical = lookup.canonical_username || lookup.input_username;
    if (canonical !== lookup.input_username) {
      return {
        status: "review",
        verification_status: "found",
        verification_reason: "username_changed",
        quality_status: "review_username_changed",
        canonical_username: canonical,
        avatar_url: safeInstagramPublicAvatarUrl(lookup.avatar_url),
        followers_count: lookup.followers_count,
        is_verified: lookup.is_verified,
        is_private: lookup.is_private,
        provider_checked_at: lookup.checked_at,
        rejected_reason: null,
        metadata_safe,
      };
    }
    if (lookup.followers_count !== null && lookup.followers_count < 500) {
      return {
        status: "rejected",
        verification_status: "found",
        verification_reason: "followers_count_below_minimum",
        quality_status: "rejected_low_followers",
        canonical_username: canonical,
        avatar_url: safeInstagramPublicAvatarUrl(lookup.avatar_url),
        followers_count: lookup.followers_count,
        is_verified: lookup.is_verified,
        is_private: lookup.is_private,
        provider_checked_at: lookup.checked_at,
        rejected_reason: "followers_count_below_minimum",
        metadata_safe,
      };
    }
    if (lookup.is_verified === true) {
      return {
        status: "rejected",
        verification_status: "found",
        verification_reason: "profile_is_verified",
        quality_status: "rejected_verified",
        canonical_username: canonical,
        avatar_url: safeInstagramPublicAvatarUrl(lookup.avatar_url),
        followers_count: lookup.followers_count,
        is_verified: lookup.is_verified,
        is_private: lookup.is_private,
        provider_checked_at: lookup.checked_at,
        rejected_reason: "profile_is_verified",
        metadata_safe,
      };
    }
    if (lookup.is_private === true) {
      return {
        status: "rejected",
        verification_status: "found",
        verification_reason: "profile_is_private",
        quality_status: "rejected_private",
        canonical_username: canonical,
        avatar_url: safeInstagramPublicAvatarUrl(lookup.avatar_url),
        followers_count: lookup.followers_count,
        is_verified: lookup.is_verified,
        is_private: lookup.is_private,
        provider_checked_at: lookup.checked_at,
        rejected_reason: "profile_is_private",
        metadata_safe,
      };
    }
    return {
      status: "valid",
      verification_status: "found",
      verification_reason: "found",
      quality_status: "eligible",
      canonical_username: canonical,
      avatar_url: safeInstagramPublicAvatarUrl(lookup.avatar_url),
      followers_count: lookup.followers_count,
      is_verified: lookup.is_verified,
      is_private: lookup.is_private,
      provider_checked_at: lookup.checked_at,
      rejected_reason: null,
      metadata_safe,
    };
  }

  if (lookup.status === "not_found") {
    return {
      ...pendingTargetVerificationDecision("username_not_found"),
      status: "rejected",
      verification_status: "not_found",
      quality_status: "rejected_not_found",
      provider_checked_at: lookup.checked_at,
      rejected_reason: "username_not_found",
      metadata_safe,
    };
  }

  if (lookup.status === "provider_not_configured") {
    return {
      ...pendingTargetVerificationDecision("provider_not_configured"),
      metadata_safe,
    };
  }

  return {
    ...pendingTargetVerificationDecision(lookup.reason || lookup.status),
    status: "review",
    verification_status: lookup.status === "rate_limited" ? "rate_limited" : lookup.status === "unavailable" ? "unavailable" : "provider_error",
    quality_status: "review_provider_unavailable",
    provider_checked_at: lookup.checked_at,
    metadata_safe,
  };
}

export async function verifySingleTargetUsername(username: string, options?: InstagramPublicProfileLookupOptions) {
  const lookup = await lookupInstagramPublicProfile(username, options);
  if (lookup.status === "username_invalid") {
    return {
      ...pendingTargetVerificationDecision("username_invalid"),
      status: "rejected" as const,
      verification_status: "provider_error" as const,
      quality_status: "unknown" as const,
      rejected_reason: "username_invalid",
    };
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
