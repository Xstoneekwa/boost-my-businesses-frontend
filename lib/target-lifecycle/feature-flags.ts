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

type TargetAvailabilityFeatureFlagKey = keyof Pick<TargetAvailabilityFeatureFlags,
  | "target_availability_observation_capture_enabled"
  | "target_availability_writer_enabled"
  | "target_availability_shadow_enabled"
  | "target_availability_policy_shadow_enabled">;

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const enabled = (value: unknown) => value === true
  || (typeof value === "string" && value.trim().toLowerCase() === "true");

const normalizeAccountId = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ACCOUNT_ID_PATTERN.test(normalized) ? normalized : null;
};

function parseAccountAllowlist(value: unknown): readonly string[] {
  let entries: unknown;

  if (Array.isArray(value)) {
    entries = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return Object.freeze([]);

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        entries = JSON.parse(trimmed);
      } catch {
        return Object.freeze([]);
      }
    } else {
      entries = trimmed.split(",");
    }
  } else {
    return Object.freeze([]);
  }

  if (!Array.isArray(entries) || entries.length === 0) return Object.freeze([]);

  const normalized = entries.map(normalizeAccountId);
  if (normalized.some((accountId) => accountId === null)) return Object.freeze([]);

  return Object.freeze([...new Set(normalized as string[])]);
}

const offFlags = (): TargetAvailabilityFeatureFlags => Object.freeze({
  target_availability_observation_capture_enabled: false,
  target_availability_writer_enabled: false,
  target_availability_shadow_enabled: false,
  target_availability_policy_shadow_enabled: false,
  killSwitch: false,
  accountAllowlist: Object.freeze([]),
});

export function resolveTargetAvailabilityFeatureFlags(
  values: Readonly<Record<string, unknown>> | null | undefined = {},
): TargetAvailabilityFeatureFlags {
  if (!values) return offFlags();

  try {
    return Object.freeze({
      target_availability_observation_capture_enabled: enabled(values.TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED),
      target_availability_writer_enabled: enabled(values.TARGET_AVAILABILITY_WRITER_ENABLED),
      target_availability_shadow_enabled: enabled(values.TARGET_AVAILABILITY_SHADOW_ENABLED),
      target_availability_policy_shadow_enabled: enabled(values.TARGET_AVAILABILITY_POLICY_SHADOW_ENABLED),
      killSwitch: enabled(values.TARGET_AVAILABILITY_KILL_SWITCH),
      accountAllowlist: parseAccountAllowlist(values.TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST),
    });
  } catch {
    return offFlags();
  }
}

export function targetAvailabilityFlagAllows(
  flags: TargetAvailabilityFeatureFlags,
  flag: TargetAvailabilityFeatureFlagKey,
  accountId: string,
) {
  const normalizedAccountId = normalizeAccountId(accountId);
  return normalizedAccountId !== null
    && !flags.killSwitch
    && flags[flag]
    && flags.accountAllowlist.length > 0
    && flags.accountAllowlist.includes(normalizedAccountId);
}
