import {
  CT_MANUAL_FOLLOWERS_MAX_GUARD,
  CT_QUALITY_MIN_FOLLOWERS,
} from "../instagram-target-quality.ts";

export type AiTargetEligibilityReasonCode =
  | "low_followers"
  | "verified"
  | "private"
  | "not_found"
  | "too_many_followers"
  | "pending_verification"
  | "rejected"
  | null;

export type AiTargetEligibility = {
  eligible: boolean;
  reasonCode: AiTargetEligibilityReasonCode;
};

export function evaluateAiTargetEligibility(input: {
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

  if (quality === "rejected_low_followers" || (followers !== null && followers < CT_QUALITY_MIN_FOLLOWERS)) {
    return { eligible: false, reasonCode: "low_followers" };
  }
  if (quality === "rejected_verified" || input.is_verified === true) {
    return { eligible: false, reasonCode: "verified" };
  }
  if (quality === "rejected_private" || input.is_private === true) {
    return { eligible: false, reasonCode: "private" };
  }
  if (quality === "rejected_not_found" || input.verification_status === "not_found") {
    return { eligible: false, reasonCode: "not_found" };
  }
  if (followers !== null && followers > CT_MANUAL_FOLLOWERS_MAX_GUARD) {
    return { eligible: false, reasonCode: "too_many_followers" };
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
