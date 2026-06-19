import {
  CT_MANUAL_FOLLOWERS_MAX_GUARD,
  CT_QUALITY_MIN_FOLLOWERS,
} from "../instagram-target-quality.ts";

export const TARGET_AI_LOCAL_FOOD_MIN_FOLLOWERS = 300;

const TARGET_AI_LOCAL_FOOD_NICHE_MARKERS = [
  "restaurant chinois",
  "restaurant asiatique",
  "restaurant japonais",
  "chinese restaurant",
  "asian restaurant",
  "chinese food",
  "local food",
  "dim sum",
  "restaurants",
  "restaurant",
  "dumplings",
  "takeaway",
  "noodles",
  "ramen",
  "sushi",
  "food",
] as const;

export type AiTargetEligibilityReasonCode =
  | "low_followers"
  | "verified"
  | "private"
  | "not_found"
  | "too_many_followers"
  | "pending_verification"
  | "out_of_target"
  | "out_of_location"
  | "not_relevant"
  | "unavailable"
  | "rejected"
  | null;

export type AiTargetEligibility = {
  eligible: boolean;
  reasonCode: AiTargetEligibilityReasonCode;
};

function normalizeNiche(niche?: string | null) {
  return (niche || "").trim().toLowerCase();
}

export function isTargetAiLocalFoodNiche(niche?: string | null) {
  const normalized = normalizeNiche(niche);
  if (!normalized) return false;
  return TARGET_AI_LOCAL_FOOD_NICHE_MARKERS.some((marker) => normalized.includes(marker));
}

export function resolveTargetAiMinFollowers(niche?: string | null) {
  return isTargetAiLocalFoodNiche(niche)
    ? TARGET_AI_LOCAL_FOOD_MIN_FOLLOWERS
    : CT_QUALITY_MIN_FOLLOWERS;
}

function isProviderUnavailable(input: {
  verification_status?: string | null;
  quality_status?: string | null;
}) {
  const quality = (input.quality_status || "").trim().toLowerCase();
  return input.verification_status === "rate_limited"
    || input.verification_status === "unavailable"
    || input.verification_status === "provider_error"
    || quality === "review_provider_unavailable"
    || quality === "provider_error"
    || quality === "provider_timeout"
    || quality.includes("provider_unavailable");
}

function canOverrideCtLowFollowersForTargetAi(input: {
  niche?: string | null;
  locHit?: boolean | null;
  nicheHit?: boolean | null;
  quality_status?: string | null;
  followers_count?: number | null;
  is_verified?: boolean | null;
  is_private?: boolean | null;
  verification_status?: string | null;
}) {
  const quality = (input.quality_status || "").trim().toLowerCase();
  const minFollowers = resolveTargetAiMinFollowers(input.niche);
  const followers = typeof input.followers_count === "number" && Number.isFinite(input.followers_count)
    ? input.followers_count
    : null;

  if (minFollowers >= CT_QUALITY_MIN_FOLLOWERS) return false;
  if (quality !== "rejected_low_followers") return false;
  if (input.verification_status !== "found") return false;
  if (followers === null || followers < minFollowers) return false;
  if (input.is_verified === true || input.is_private === true) return false;
  if (input.locHit !== true || input.nicheHit !== true) return false;
  return true;
}

export function evaluateAiTargetEligibility(input: {
  niche?: string | null;
  locHit?: boolean | null;
  nicheHit?: boolean | null;
  quality_status?: string | null;
  status?: string | null;
  followers_count?: number | null;
  is_verified?: boolean | null;
  is_private?: boolean | null;
  verification_status?: string | null;
}): AiTargetEligibility {
  const quality = (input.quality_status || "").trim().toLowerCase();
  const status = (input.status || "").trim().toLowerCase();
  const followers = typeof input.followers_count === "number" && Number.isFinite(input.followers_count)
    ? input.followers_count
    : null;
  const minFollowers = resolveTargetAiMinFollowers(input.niche);

  if (quality === "rejected_not_found" || input.verification_status === "not_found") {
    return { eligible: false, reasonCode: "not_found" };
  }
  if (isProviderUnavailable(input)) {
    return { eligible: false, reasonCode: "unavailable" };
  }
  if (quality === "rejected_verified" || input.is_verified === true) {
    return { eligible: false, reasonCode: "verified" };
  }
  if (quality === "rejected_private" || input.is_private === true) {
    return { eligible: false, reasonCode: "private" };
  }
  if (quality === "rejected_out_of_target") {
    return { eligible: false, reasonCode: "out_of_target" };
  }
  if (quality === "rejected_out_of_location") {
    return { eligible: false, reasonCode: "out_of_location" };
  }
  if (quality === "rejected_not_relevant") {
    return { eligible: false, reasonCode: "not_relevant" };
  }
  if (followers !== null && followers > CT_MANUAL_FOLLOWERS_MAX_GUARD) {
    return { eligible: false, reasonCode: "too_many_followers" };
  }
  if (followers !== null && followers < minFollowers) {
    return { eligible: false, reasonCode: "low_followers" };
  }
  if (quality === "rejected_low_followers" && followers === null) {
    return { eligible: false, reasonCode: "low_followers" };
  }
  if (canOverrideCtLowFollowersForTargetAi(input)) {
    return { eligible: true, reasonCode: null };
  }
  if (status === "rejected" || quality.startsWith("rejected")) {
    return { eligible: false, reasonCode: "rejected" };
  }
  if (status === "valid" && quality === "eligible") {
    return { eligible: true, reasonCode: null };
  }
  if (status === "pending_verification" || quality === "unknown" || input.verification_status === "pending") {
    return { eligible: false, reasonCode: "pending_verification" };
  }
  return { eligible: false, reasonCode: "rejected" };
}

export function hasIneligibleAiTargetSelection<T extends { eligible: boolean }>(items: T[]) {
  return items.some((item) => !item.eligible);
}
