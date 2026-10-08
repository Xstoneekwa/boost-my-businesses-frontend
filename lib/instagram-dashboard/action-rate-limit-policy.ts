export const INSTAGRAM_ACTION_RATE_LIMIT = "instagram_action_rate_limit";
export const ACTION_RATE_LIMIT_POLICY_SOURCE = "bmb_operational_policy_48h";

type Row = Record<string, unknown>;

export function isIncidentOnlyActionRateLimit(input: {
  reason?: unknown;
  failureReason?: unknown;
  metadata?: unknown;
}) {
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata as Row
    : {};
  return String(input.reason || input.failureReason || "").trim() === INSTAGRAM_ACTION_RATE_LIMIT
    && metadata.incident_only_blocker_v2 === true;
}

export function projectActionRateLimitPause(metadataValue: unknown, lang: "fr" | "en") {
  const metadata = metadataValue && typeof metadataValue === "object" && !Array.isArray(metadataValue)
    ? metadataValue as Row
    : {};
  const detectedAt = typeof metadata.detected_at === "string" ? metadata.detected_at : null;
  const recommendedPauseUntil = typeof metadata.recommended_pause_until === "string"
    ? metadata.recommended_pause_until
    : null;
  return {
    label: lang === "fr" ? "Pause de 48 h requise" : "48h pause required",
    explanation: lang === "fr"
      ? "Instagram a temporairement limité certaines actions. La pause de 48 h est une recommandation opérationnelle BMB."
      : "Instagram temporarily limited some actions. The 48h pause is a BMB operational recommendation.",
    detectedAt,
    recommendedPauseUntil,
    policySource: typeof metadata.pause_policy_source === "string"
      ? metadata.pause_policy_source
      : ACTION_RATE_LIMIT_POLICY_SOURCE,
    instagramExactExpiryProvided: metadata.instagram_exact_expiry_provided === true,
  };
}
