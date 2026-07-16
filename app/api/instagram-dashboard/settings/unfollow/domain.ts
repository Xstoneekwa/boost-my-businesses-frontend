import type { UnfollowRuntimeCapMode } from "@/lib/instagram-dashboard/run-control";

export const SUPPORTED_UNFOLLOW_MODES = ["unfollow", "unfollow-any"] as const;
export const PLANNED_UNFOLLOW_MODE = "unfollow-non-followers";

type SupportedUnfollowMode = (typeof SUPPORTED_UNFOLLOW_MODES)[number];

export type UnfollowDomainPatchPayload = {
  account_id?: unknown;
  idempotency_key?: unknown;
  unfollow_enabled?: unknown;
  unfollow_mode?: unknown;
  unfollow_per_session_limit?: unknown;
  unfollow_per_day_limit?: unknown;
  unfollow_after_days?: unknown;
  runtime_cap_mode?: unknown;
  runtime_safety_cap?: unknown;
};

export type UnfollowDomainInput = {
  unfollowEnabled: boolean;
  unfollowMode: string;
  unfollowPerSessionLimit: number;
  unfollowPerDayLimit: number;
  unfollowAfterDays: number;
  runtimeCapMode: UnfollowRuntimeCapMode;
  runtimeSafetyCap: number | null;
};

export function validateUnfollowDomainInput(input: UnfollowDomainInput) {
  if (input.unfollowMode === PLANNED_UNFOLLOW_MODE) {
    return "unfollow_non_followers_planned";
  }
  if (!SUPPORTED_UNFOLLOW_MODES.includes(input.unfollowMode as SupportedUnfollowMode)) {
    return "unfollow_mode_not_supported";
  }
  if (input.unfollowEnabled && input.unfollowPerSessionLimit < 1) {
    return "unfollow_cap_unproven";
  }
  if (input.unfollowEnabled && input.unfollowPerDayLimit < 1) {
    return "unfollow_cap_unproven";
  }
  if (
    input.unfollowEnabled &&
    input.runtimeCapMode !== "prod_normal" &&
    (input.runtimeSafetyCap === null || input.runtimeSafetyCap < 1)
  ) {
    return "unfollow_cap_unproven";
  }
  if (input.unfollowEnabled && input.unfollowPerSessionLimit > input.unfollowPerDayLimit) {
    return "session_cap_exceeds_day_cap";
  }
  return null;
}

export function unfollowChangedFields(before: UnfollowDomainInput, after: UnfollowDomainInput) {
  const fields: string[] = [];
  if (before.unfollowEnabled !== after.unfollowEnabled) fields.push("unfollow_enabled");
  if (before.unfollowMode !== after.unfollowMode) fields.push("unfollow_mode");
  if (before.unfollowPerSessionLimit !== after.unfollowPerSessionLimit) fields.push("unfollow_per_session_limit");
  if (before.unfollowPerDayLimit !== after.unfollowPerDayLimit) fields.push("unfollow_per_day_limit");
  if (before.unfollowAfterDays !== after.unfollowAfterDays) fields.push("unfollow_after_days");
  if (before.runtimeCapMode !== after.runtimeCapMode) fields.push("runtime_cap_mode");
  if (before.runtimeSafetyCap !== after.runtimeSafetyCap) fields.push("runtime_safety_cap");
  return fields;
}
