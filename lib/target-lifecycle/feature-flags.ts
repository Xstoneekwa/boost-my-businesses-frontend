export const TARGET_AVAILABILITY_FEATURE_FLAG_NAMES = Object.freeze({
  capture: "target_availability_observation_capture_enabled",
  writer: "target_availability_writer_enabled",
  shadow: "target_availability_shadow_enabled",
  policyShadow: "target_availability_policy_shadow_enabled",
} as const);

export type TargetAvailabilityFeatureFlags = Readonly<{
  target_availability_observation_capture_enabled: boolean;
  target_availability_writer_enabled: boolean;
  target_availability_shadow_enabled: boolean;
  target_availability_policy_shadow_enabled: boolean;
  killSwitch: boolean;
  accountAllowlist: readonly string[];
}>;

const enabled = (value: unknown) => ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());

export function resolveTargetAvailabilityFeatureFlags(
  values: Readonly<Record<string, unknown>> = {},
): TargetAvailabilityFeatureFlags {
  return Object.freeze({
    target_availability_observation_capture_enabled: enabled(values.TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED),
    target_availability_writer_enabled: enabled(values.TARGET_AVAILABILITY_WRITER_ENABLED),
    target_availability_shadow_enabled: enabled(values.TARGET_AVAILABILITY_SHADOW_ENABLED),
    target_availability_policy_shadow_enabled: enabled(values.TARGET_AVAILABILITY_POLICY_SHADOW_ENABLED),
    killSwitch: enabled(values.TARGET_AVAILABILITY_KILL_SWITCH),
    accountAllowlist: Object.freeze(String(values.TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST ?? "").split(",").map((item) => item.trim()).filter(Boolean)),
  });
}

export function targetAvailabilityFlagAllows(
  flags: TargetAvailabilityFeatureFlags,
  flag: keyof Pick<TargetAvailabilityFeatureFlags,
    | "target_availability_observation_capture_enabled"
    | "target_availability_writer_enabled"
    | "target_availability_shadow_enabled"
    | "target_availability_policy_shadow_enabled">,
  accountId: string,
) {
  return !flags.killSwitch && flags[flag]
    && (!flags.accountAllowlist.length || flags.accountAllowlist.includes(accountId));
}
