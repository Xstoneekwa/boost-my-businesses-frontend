export const CT_QUALITY_MIN_FOLLOWERS = 500;
export const CT_MANUAL_FOLLOWERS_MAX_GUARD = 50_000;

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

export type TargetQualitySeverity = "info" | "warning" | "review" | "rejected";
export type TargetQualitySyncVisibility = "admin_client_botapp" | "admin_review_client_safe" | "admin_only";

export type TargetQualityEvaluationInput = {
  verification_status: TargetVerificationStatus | "provider_not_configured" | "username_invalid";
  provider_status?: string | null;
  normalized_username?: string | null;
  canonical_username?: string | null;
  instagram_user_id?: string | null;
  external_profile_id?: string | null;
  followers_count?: number | null;
  is_verified?: boolean | null;
  is_private?: boolean | null;
  avatar_url?: string | null;
  provider_checked_at?: string | null;
  provider_error_reason?: string | null;
  metadata_safe?: Record<string, string | number | boolean | null>;
};

export type TargetQualityDecision = {
  status: TargetStatus;
  verification_status: TargetVerificationStatus;
  verification_reason: string;
  quality_status: TargetQualityStatus;
  canonical_username: string | null;
  instagram_user_id: string | null;
  external_profile_id: string | null;
  avatar_url: string | null;
  followers_count: number | null;
  is_verified: boolean | null;
  is_private: boolean | null;
  provider_checked_at: string | null;
  rejected_reason: string | null;
  metadata_safe: Record<string, string | number | boolean | null>;
  severity: TargetQualitySeverity;
  sync_visibility: TargetQualitySyncVisibility;
  warning: string | null;
};

export function safeTargetQualityReason(value: string | null | undefined, fallback = "unknown") {
  return (value || fallback).trim().toLowerCase().replace(/[^a-z0-9_:-]/g, "_").slice(0, 120) || fallback;
}

function normalizedText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function baseDecision(input: TargetQualityEvaluationInput, reason: string): TargetQualityDecision {
  const metadata = {
    ...(input.metadata_safe ?? {}),
    ...(input.instagram_user_id ? { instagram_user_id: input.instagram_user_id } : {}),
    ...(input.external_profile_id ? { external_profile_id: input.external_profile_id } : {}),
  };
  return {
    status: "pending_verification",
    verification_status: "pending",
    verification_reason: safeTargetQualityReason(reason),
    quality_status: "unknown",
    canonical_username: input.canonical_username || null,
    instagram_user_id: input.instagram_user_id || null,
    external_profile_id: input.external_profile_id || null,
    avatar_url: input.avatar_url || null,
    followers_count: typeof input.followers_count === "number" && Number.isFinite(input.followers_count) ? input.followers_count : null,
    is_verified: typeof input.is_verified === "boolean" ? input.is_verified : null,
    is_private: typeof input.is_private === "boolean" ? input.is_private : null,
    provider_checked_at: input.provider_checked_at || null,
    rejected_reason: null,
    metadata_safe: metadata,
    severity: "info",
    sync_visibility: "admin_client_botapp",
    warning: input.avatar_url ? null : "avatar_missing",
  };
}

export function evaluateTargetQuality(input: TargetQualityEvaluationInput): TargetQualityDecision {
  if (input.verification_status === "provider_not_configured") {
    return {
      ...baseDecision(input, "provider_not_configured"),
      sync_visibility: "admin_review_client_safe",
    };
  }

  if (input.verification_status === "username_invalid") {
    return {
      ...baseDecision(input, "username_invalid"),
      status: "rejected",
      verification_status: "provider_error",
      rejected_reason: "username_invalid",
      severity: "rejected",
      sync_visibility: "admin_client_botapp",
    };
  }

  if (input.verification_status === "not_found") {
    return {
      ...baseDecision(input, "username_not_found"),
      status: "rejected",
      verification_status: "not_found",
      quality_status: "rejected_not_found",
      rejected_reason: "username_not_found",
      severity: "rejected",
    };
  }

  if (input.verification_status === "rate_limited" || input.verification_status === "unavailable" || input.verification_status === "provider_error") {
    return {
      ...baseDecision(input, input.provider_error_reason || input.verification_status),
      status: "review",
      verification_status: input.verification_status,
      quality_status: "review_provider_unavailable",
      severity: "review",
      sync_visibility: "admin_review_client_safe",
    };
  }

  if (input.verification_status !== "found") {
    return baseDecision(input, input.provider_error_reason || "verification_pending");
  }

  const normalizedUsername = normalizedText(input.normalized_username);
  const canonicalUsername = normalizedText(input.canonical_username || input.normalized_username);
  const found = {
    ...baseDecision(input, "found"),
    verification_status: "found" as const,
    canonical_username: canonicalUsername || input.canonical_username || null,
  };

  if (normalizedUsername && canonicalUsername && canonicalUsername !== normalizedUsername) {
    return {
      ...found,
      status: "review",
      verification_reason: "username_changed",
      quality_status: "review_username_changed",
      severity: "review",
      sync_visibility: "admin_review_client_safe",
    };
  }

  if (found.followers_count !== null && found.followers_count < CT_QUALITY_MIN_FOLLOWERS) {
    return {
      ...found,
      status: "rejected",
      verification_reason: "followers_count_below_minimum",
      quality_status: "rejected_low_followers",
      rejected_reason: "followers_count_below_minimum",
      severity: "rejected",
    };
  }

  if (found.is_verified === true) {
    return {
      ...found,
      status: "rejected",
      verification_reason: "profile_is_verified",
      quality_status: "rejected_verified",
      rejected_reason: "profile_is_verified",
      severity: "rejected",
    };
  }

  if (found.is_private === true) {
    return {
      ...found,
      status: "rejected",
      verification_reason: "profile_is_private",
      quality_status: "rejected_private",
      rejected_reason: "profile_is_private",
      severity: "rejected",
    };
  }

  return {
    ...found,
    status: "valid",
    quality_status: "eligible",
    severity: found.warning ? "warning" : "info",
  };
}
