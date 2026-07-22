export type FollowOverrideSource = "admin" | "support" | "migration_confirmed";

export type FollowLimitOverride = {
  followDayCapOverride: number | null;
  followSessionCapOverride: number | null;
  source: FollowOverrideSource;
};

export type FollowWarmupInput = {
  enabled: boolean;
  packageStartedAt: string | null;
  day1FollowCap?: number | null;
  day2FollowCap?: number | null;
  day3FollowCap?: number | null;
  day4PlusFollowCap?: number | null;
};

export type AccountFollowBusinessPolicyInput = {
  packageCode: string | null;
  packageDayCap: number | null;
  packageSessionCap: number | null;
  override: FollowLimitOverride | null;
  warmup: FollowWarmupInput;
  asOf?: string | Date;
};

export type FollowBusinessLimitingSource =
  | "package_default"
  | "account_override"
  | "warmup"
  | "mixed"
  | "package_unavailable";

type DimensionSource = Exclude<FollowBusinessLimitingSource, "mixed" | "package_unavailable">;

export type AccountFollowBusinessPolicy = {
  package_day_cap: number | null;
  package_session_cap: number | null;
  account_day_override: number | null;
  account_session_override: number | null;
  account_override_present: boolean;
  account_override_source: FollowOverrideSource | null;
  account_override_above_package: boolean;
  warmup_enabled: boolean;
  warmup_day: number | null;
  warmup_day_cap: number | null;
  warmup_session_cap: number | null;
  business_day_cap: number | null;
  business_session_cap: number | null;
  day_limiting_source: DimensionSource | "package_unavailable";
  session_limiting_source: DimensionSource | "package_unavailable";
  limiting_source: FollowBusinessLimitingSource;
  limiting_reason: string;
  warmup_timezone: "UTC";
};

function positiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function utcDayNumber(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function resolveWarmupDayUtc(packageStartedAt: string | null, asOf: string | Date = new Date()) {
  if (!packageStartedAt) return null;
  const started = new Date(packageStartedAt);
  const current = asOf instanceof Date ? asOf : new Date(asOf);
  if (Number.isNaN(started.getTime()) || Number.isNaN(current.getTime())) return null;
  return Math.max(1, Math.floor((utcDayNumber(current) - utcDayNumber(started)) / 86_400_000) + 1);
}

function dimensionSource(
  packageCap: number,
  overrideCap: number | null,
  warmupCap: number | null,
): DimensionSource {
  const effective = Math.min(packageCap, overrideCap ?? packageCap, warmupCap ?? packageCap);
  if (warmupCap !== null && warmupCap === effective && warmupCap < packageCap && warmupCap <= (overrideCap ?? packageCap)) {
    return "warmup";
  }
  if (overrideCap !== null && overrideCap === effective && overrideCap < packageCap) {
    return "account_override";
  }
  return "package_default";
}

function warmupCapForDay(
  warmupDay: number,
  warmup: FollowWarmupInput,
  packageCap: number,
) {
  if (warmupDay <= 1) return Math.min(positiveInteger(warmup.day1FollowCap) ?? 10, packageCap);
  if (warmupDay === 2) return Math.min(positiveInteger(warmup.day2FollowCap) ?? 20, packageCap);
  if (warmupDay === 3) return Math.min(positiveInteger(warmup.day3FollowCap) ?? 40, packageCap);
  return Math.min(positiveInteger(warmup.day4PlusFollowCap) ?? packageCap, packageCap);
}

export function resolveAccountFollowBusinessPolicy(
  input: AccountFollowBusinessPolicyInput,
): AccountFollowBusinessPolicy {
  const packageDayCap = positiveInteger(input.packageDayCap);
  const packageSessionCap = positiveInteger(input.packageSessionCap);
  const accountDayOverride = positiveInteger(input.override?.followDayCapOverride);
  const accountSessionOverride = positiveInteger(input.override?.followSessionCapOverride);
  const warmupDay = input.warmup.enabled
    ? resolveWarmupDayUtc(input.warmup.packageStartedAt, input.asOf)
    : null;

  if (packageDayCap === null || packageSessionCap === null) {
    return {
      package_day_cap: packageDayCap,
      package_session_cap: packageSessionCap,
      account_day_override: accountDayOverride,
      account_session_override: accountSessionOverride,
      account_override_present: input.override !== null,
      account_override_source: input.override?.source ?? null,
      account_override_above_package: false,
      warmup_enabled: input.warmup.enabled,
      warmup_day: warmupDay,
      warmup_day_cap: null,
      warmup_session_cap: null,
      business_day_cap: null,
      business_session_cap: null,
      day_limiting_source: "package_unavailable",
      session_limiting_source: "package_unavailable",
      limiting_source: "package_unavailable",
      limiting_reason: input.packageCode ? "package_has_no_follow_cap" : "effective_package_missing",
      warmup_timezone: "UTC",
    };
  }

  const warmupDayCap = warmupDay === null
    ? null
    : warmupCapForDay(warmupDay, input.warmup, packageDayCap);
  const warmupSessionCap = warmupDay === null
    ? null
    : warmupCapForDay(warmupDay, input.warmup, packageSessionCap);
  const businessDayCap = Math.min(packageDayCap, accountDayOverride ?? packageDayCap, warmupDayCap ?? packageDayCap);
  const businessSessionCap = Math.min(
    packageSessionCap,
    accountSessionOverride ?? packageSessionCap,
    warmupSessionCap ?? packageSessionCap,
  );
  const daySource = dimensionSource(packageDayCap, accountDayOverride, warmupDayCap);
  const sessionSource = dimensionSource(packageSessionCap, accountSessionOverride, warmupSessionCap);
  const limitingSource = daySource === sessionSource ? daySource : "mixed";
  const overrideAbovePackage = (accountDayOverride !== null && accountDayOverride > packageDayCap)
    || (accountSessionOverride !== null && accountSessionOverride > packageSessionCap);
  const limitingReason = overrideAbovePackage
    ? "override_above_package_bounded"
    : limitingSource === "mixed"
      ? `day_limited_by_${daySource};session_limited_by_${sessionSource}`
      : limitingSource === "warmup"
        ? "limited_by_warmup"
        : limitingSource === "account_override"
          ? "limited_by_account_override"
          : "limited_by_package";

  return {
    package_day_cap: packageDayCap,
    package_session_cap: packageSessionCap,
    account_day_override: accountDayOverride,
    account_session_override: accountSessionOverride,
    account_override_present: input.override !== null,
    account_override_source: input.override?.source ?? null,
    account_override_above_package: overrideAbovePackage,
    warmup_enabled: input.warmup.enabled,
    warmup_day: warmupDay,
    warmup_day_cap: warmupDayCap,
    warmup_session_cap: warmupSessionCap,
    business_day_cap: businessDayCap,
    business_session_cap: businessSessionCap,
    day_limiting_source: daySource,
    session_limiting_source: sessionSource,
    limiting_source: limitingSource,
    limiting_reason: limitingReason,
    warmup_timezone: "UTC",
  };
}
