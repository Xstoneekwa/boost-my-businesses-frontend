export type FollowCapSource = "admin_override" | "warmup" | "package_default";

type FollowCapProjectionInput = {
  packageDayCap: number;
  packageSessionCap: number;
  adminDayCap: number | null;
  adminSessionCap: number | null;
  warmupApplied: boolean;
  warmupDayCap: number | null;
  followedToday: number;
};

function cap(value: number) {
  return Math.max(0, Math.floor(value));
}

export function projectFollowCaps(input: FollowCapProjectionInput) {
  const packageDayCap = cap(input.packageDayCap);
  const packageSessionCap = cap(input.packageSessionCap);
  const adminDayCap = input.adminDayCap === null ? packageDayCap : cap(input.adminDayCap);
  const adminSessionCap = input.adminSessionCap === null ? packageSessionCap : cap(input.adminSessionCap);
  const warmupDayCap = input.warmupApplied && input.warmupDayCap !== null
    ? cap(input.warmupDayCap)
    : packageDayCap;
  const effectiveDayCap = Math.min(packageDayCap, warmupDayCap, adminDayCap);
  const dailyRemaining = Math.max(0, effectiveDayCap - cap(input.followedToday));
  const effectiveSessionCap = Math.min(packageSessionCap, adminSessionCap, dailyRemaining);

  let dailySource: FollowCapSource = "package_default";
  if (input.warmupApplied && warmupDayCap < packageDayCap && warmupDayCap <= adminDayCap) {
    dailySource = "warmup";
  } else if (input.adminDayCap !== null && adminDayCap < packageDayCap) {
    dailySource = "admin_override";
  }

  let sessionSource: FollowCapSource | "daily_remaining" = dailySource;
  if (dailyRemaining <= packageSessionCap && dailyRemaining <= adminSessionCap) {
    sessionSource = "daily_remaining";
  } else if (input.adminSessionCap !== null && adminSessionCap < packageSessionCap) {
    sessionSource = "admin_override";
  } else if (packageSessionCap < dailyRemaining) {
    sessionSource = "package_default";
  }

  return {
    packageDayCap,
    packageSessionCap,
    adminDayCap: input.adminDayCap === null ? null : adminDayCap,
    adminSessionCap: input.adminSessionCap === null ? null : adminSessionCap,
    warmupDayCap: input.warmupApplied ? warmupDayCap : null,
    effectiveDayCap,
    effectiveSessionCap,
    dailyRemaining,
    dailySource,
    sessionSource,
    limitingReason: dailySource === "admin_override"
      ? "limited_by_admin_override"
      : dailySource === "warmup"
        ? "limited_by_warmup"
        : "limited_by_package",
  } as const;
}
