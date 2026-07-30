import type { AvailabilityConfidence, AvailabilitySignal } from "./engine-types.ts";

export const TARGET_AVAILABILITY_ENGINE_VERSION = "target-availability-engine-v3";
export const TARGET_AVAILABILITY_RULE_VERSION = "target-availability-rules-v1";
export const TARGET_AVAILABILITY_POLICY_VERSION = "target-availability-policy-v1";
export const TARGET_AVAILABILITY_ENGINE_REVISION = 3;
export const TARGET_AVAILABILITY_POLICY_REVISION = 1;

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

export type SignalRule = Readonly<{
  ttlMs: number;
  repeatRequired: number;
  distinctRunsRequired: number;
  weight: number;
  baseConfidence: AvailabilityConfidence;
  permanentUnavailableAllowed: boolean;
}>;

const rule = (
  ttlMs: number,
  repeatRequired: number,
  distinctRunsRequired: number,
  weight: number,
  baseConfidence: AvailabilityConfidence,
  permanentUnavailableAllowed = false,
): SignalRule => Object.freeze({ ttlMs, repeatRequired, distinctRunsRequired, weight, baseConfidence, permanentUnavailableAllowed });

export const TARGET_AVAILABILITY_SIGNAL_RULES: Readonly<Record<AvailabilitySignal, SignalRule>> = Object.freeze({
  profile_available: rule(24 * hour, 1, 1, 4, "high"),
  profile_unavailable: rule(hour, 2, 2, 2, "low"),
  account_deleted: rule(24 * hour, 2, 2, 5, "medium", true),
  account_suspended: rule(24 * hour, 2, 2, 4, "medium", true),
  account_banned: rule(24 * hour, 2, 2, 5, "medium", true),
  username_changed: rule(7 * day, 1, 1, 5, "high"),
  username_change_suspected: rule(7 * day, 2, 2, 2, "low"),
  login_wall: rule(15 * minute, 1, 1, 1, "low"),
  access_restricted: rule(hour, 2, 2, 2, "low"),
  verified_badge_present: rule(7 * day, 1, 1, 0, "low"),
  followers_surface_restricted: rule(hour, 2, 2, 2, "low"),
  verified_followers_restricted: rule(7 * day, 2, 2, 4, "medium"),
  temporary_instagram_error: rule(15 * minute, 1, 1, 0, "low"),
  network_error: rule(15 * minute, 1, 1, 0, "low"),
  ui_inconsistency: rule(hour, 1, 1, 0, "low"),
  identity_conflict: rule(7 * day, 1, 1, 5, "high"),
  ambiguous_identity: rule(hour, 1, 1, 1, "low"),
  stale_observation: rule(minute, 1, 1, 0, "unknown"),
  insufficient_evidence: rule(15 * minute, 1, 1, 0, "unknown"),
});

export const TARGET_AVAILABILITY_FRESHNESS = Object.freeze({
  identityStaleAfterMs: 14 * day,
  repeatWindowMs: 7 * day,
  assessmentTtlMs: 24 * hour,
  temporaryAssessmentTtlMs: hour,
  ambiguousAssessmentTtlMs: 15 * minute,
});

export function confidenceRank(value: AvailabilityConfidence) {
  return ({ unknown: 0, low: 1, medium: 2, high: 3 } as const)[value];
}
