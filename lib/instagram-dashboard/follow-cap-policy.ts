export type PackageFollowPolicy = {
  defaultDayCap: number;
  defaultSessionCap: number;
  maxDayCap: number;
  maxSessionCap: number;
};

export type FollowCapValidationResult =
  | {
    ok: true;
    configuredDayCap: number;
    configuredSessionCap: number;
  }
  | {
    ok: false;
    code:
      | "package_follow_policy_unavailable"
      | "configured_follow_day_cap_invalid"
      | "configured_follow_session_cap_invalid"
      | "configured_follow_day_cap_exceeds_package"
      | "configured_follow_session_cap_exceeds_package";
    message: string;
  };

export type ConfiguredWarmupCaps = {
  day1: number;
  day2: number;
  day3: number;
  day4Plus: number;
};

type WarmupStorageKey = "day_1_follow_cap" | "day_2_follow_cap" | "day_3_follow_cap" | "day_4_plus_follow_cap";

export type WarmupCapValidationResult =
  | ({ ok: true } & ConfiguredWarmupCaps)
  | {
    ok: false;
    code:
      | "package_follow_policy_unavailable"
      | "warmup_day_1_invalid"
      | "warmup_day_2_invalid"
      | "warmup_day_3_invalid"
      | "warmup_day_4_plus_invalid"
      | "warmup_cap_exceeds_package"
      | "warmup_progression_not_monotonic";
    message: string;
  };

export type EffectiveFollowCapsToday = {
  dayCap: number;
  sessionCap: number;
  remainingDayQuota: number;
};

type JsonRecord = Record<string, unknown>;

function positiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function strictPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function resolvePackageFollowPolicy(
  packageDefaults: JsonRecord | null | undefined,
  packageCaps: JsonRecord | null | undefined,
): PackageFollowPolicy | null {
  const defaultDayCap = positiveInteger(packageDefaults?.follow_day ?? packageCaps?.follow_day);
  const defaultSessionCap = positiveInteger(packageDefaults?.follow_session ?? packageCaps?.follow_session);
  const maxDayCap = positiveInteger(packageCaps?.follow_day);
  const maxSessionCap = positiveInteger(packageCaps?.follow_session);

  if (!defaultDayCap || !defaultSessionCap || !maxDayCap || !maxSessionCap) return null;
  if (defaultDayCap > maxDayCap || defaultSessionCap > maxSessionCap) return null;

  return { defaultDayCap, defaultSessionCap, maxDayCap, maxSessionCap };
}

export function validateConfiguredFollowCaps(input: {
  configuredDayCap: unknown;
  configuredSessionCap: unknown;
  packagePolicy: PackageFollowPolicy | null;
}): FollowCapValidationResult {
  if (!input.packagePolicy) {
    return {
      ok: false,
      code: "package_follow_policy_unavailable",
      message: "Cannot save Follow limits: the account has no active package Follow policy.",
    };
  }

  const configuredDayCap = positiveInteger(input.configuredDayCap);
  if (!configuredDayCap) {
    return {
      ok: false,
      code: "configured_follow_day_cap_invalid",
      message: "Follow cap/day must be a positive integer.",
    };
  }

  const configuredSessionCap = positiveInteger(input.configuredSessionCap);
  if (!configuredSessionCap) {
    return {
      ok: false,
      code: "configured_follow_session_cap_invalid",
      message: "Follow cap/session must be a positive integer.",
    };
  }

  if (configuredDayCap > input.packagePolicy.maxDayCap) {
    return {
      ok: false,
      code: "configured_follow_day_cap_exceeds_package",
      message: `Follow cap/day cannot exceed the package maximum (${input.packagePolicy.maxDayCap}).`,
    };
  }

  if (configuredSessionCap > input.packagePolicy.maxSessionCap) {
    return {
      ok: false,
      code: "configured_follow_session_cap_exceeds_package",
      message: `Follow cap/session cannot exceed the package maximum (${input.packagePolicy.maxSessionCap}).`,
    };
  }

  return { ok: true, configuredDayCap, configuredSessionCap };
}

export function defaultConfiguredWarmupCaps(packagePolicy: PackageFollowPolicy): ConfiguredWarmupCaps {
  const packageMaximum = Math.min(packagePolicy.maxDayCap, packagePolicy.maxSessionCap);
  return {
    day1: Math.min(10, packageMaximum),
    day2: Math.min(20, packageMaximum),
    day3: Math.min(40, packageMaximum),
    day4Plus: packageMaximum,
  };
}

export function mergeConfiguredWarmupCapFields(input: {
  patch: object;
  existing: Partial<Record<WarmupStorageKey, unknown>> | null | undefined;
  defaults: ConfiguredWarmupCaps;
}) {
  const patch = input.patch as Partial<Record<WarmupStorageKey, unknown>>;
  const value = (key: WarmupStorageKey, fallback: number) => {
    if (Object.prototype.hasOwnProperty.call(patch, key)) return patch[key];
    const current = input.existing?.[key];
    return current === null || current === undefined ? fallback : current;
  };
  return {
    day1: value("day_1_follow_cap", input.defaults.day1),
    day2: value("day_2_follow_cap", input.defaults.day2),
    day3: value("day_3_follow_cap", input.defaults.day3),
    day4Plus: value("day_4_plus_follow_cap", input.defaults.day4Plus),
  };
}

export function validateConfiguredWarmupCaps(input: {
  day1: unknown;
  day2: unknown;
  day3: unknown;
  day4Plus: unknown;
  packagePolicy: PackageFollowPolicy | null;
}): WarmupCapValidationResult {
  if (!input.packagePolicy) {
    return {
      ok: false,
      code: "package_follow_policy_unavailable",
      message: "Cannot save Follow warmup limits: the account has no active package Follow policy.",
    };
  }

  const fields = [
    ["Day 1", "warmup_day_1_invalid", strictPositiveInteger(input.day1)],
    ["Day 2", "warmup_day_2_invalid", strictPositiveInteger(input.day2)],
    ["Day 3", "warmup_day_3_invalid", strictPositiveInteger(input.day3)],
    ["Day 4+", "warmup_day_4_plus_invalid", strictPositiveInteger(input.day4Plus)],
  ] as const;
  for (const [label, code, value] of fields) {
    if (value === null) {
      return {
        ok: false,
        code,
        message: `${label} Follow warmup cap must be a positive integer.`,
      };
    }
  }

  const [day1, day2, day3, day4Plus] = fields.map(([, , value]) => value as number);
  const packageMaximum = Math.min(input.packagePolicy.maxDayCap, input.packagePolicy.maxSessionCap);
  if (Math.max(day1, day2, day3, day4Plus) > packageMaximum) {
    return {
      ok: false,
      code: "warmup_cap_exceeds_package",
      message: `Follow warmup caps cannot exceed the package maximum (${packageMaximum}).`,
    };
  }
  if (!(day1 <= day2 && day2 <= day3 && day3 <= day4Plus)) {
    return {
      ok: false,
      code: "warmup_progression_not_monotonic",
      message: "Follow warmup progression must satisfy Day 1 <= Day 2 <= Day 3 <= Day 4+.",
    };
  }

  return { ok: true, day1, day2, day3, day4Plus };
}

export function resolveEffectiveFollowCapsToday(input: {
  packageDayCap: number;
  packageSessionCap: number;
  configuredAccountDayCap: number | null;
  configuredAccountSessionCap: number | null;
  warmupApplied: boolean;
  warmupCap: number | null;
  followsCompletedToday: number;
}): EffectiveFollowCapsToday {
  const packageDayCap = Math.max(0, input.packageDayCap);
  const packageSessionCap = Math.max(0, input.packageSessionCap);
  const accountDayCap = input.configuredAccountDayCap === null
    ? packageDayCap
    : Math.max(0, input.configuredAccountDayCap);
  const accountSessionCap = input.configuredAccountSessionCap === null
    ? packageSessionCap
    : Math.max(0, input.configuredAccountSessionCap);
  const warmupDayCap = input.warmupApplied && input.warmupCap !== null
    ? Math.max(0, input.warmupCap)
    : packageDayCap;
  const warmupSessionCap = input.warmupApplied && input.warmupCap !== null
    ? Math.max(0, input.warmupCap)
    : packageSessionCap;
  const dayCap = Math.min(packageDayCap, accountDayCap, warmupDayCap);
  const remainingDayQuota = Math.max(0, dayCap - Math.max(0, input.followsCompletedToday));
  const sessionCap = Math.min(packageSessionCap, accountSessionCap, warmupSessionCap, remainingDayQuota);
  return { dayCap, sessionCap, remainingDayQuota };
}
