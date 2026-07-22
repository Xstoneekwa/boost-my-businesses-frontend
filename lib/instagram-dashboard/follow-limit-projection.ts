import type { AccountFollowBusinessPolicy } from "./follow-business-policy";

export type LegacyFollowLimitValues = {
  maxActionsPerDay: number | null;
  followLimit: number | null;
  maxFollowPerRun: number | null;
};

export function buildAccountFollowLimitProjection(
  policy: AccountFollowBusinessPolicy,
  legacy: LegacyFollowLimitValues,
) {
  return {
    package_limits: {
      day: policy.package_day_cap,
      session: policy.package_session_cap,
    },
    account_override: {
      present: policy.account_override_present,
      day: policy.account_day_override,
      session: policy.account_session_override,
      source: policy.account_override_source,
      status: policy.account_override_present ? "Account override" : "None — using package defaults",
      above_package: policy.account_override_above_package,
    },
    warmup: {
      enabled: policy.warmup_enabled,
      day: policy.warmup_day,
      day_cap: policy.warmup_day_cap,
      session_cap: policy.warmup_session_cap,
      timezone: policy.warmup_timezone,
    },
    business_effective: {
      day: policy.business_day_cap,
      session: policy.business_session_cap,
      limiting_source: policy.limiting_source,
      limiting_reason: policy.limiting_reason,
      day_limiting_source: policy.day_limiting_source,
      session_limiting_source: policy.session_limiting_source,
    },
    legacy: {
      max_actions_per_day: legacy.maxActionsPerDay,
      follow_limit: legacy.followLimit,
      max_follow_per_run: legacy.maxFollowPerRun,
      read_only: true as const,
      label: "Legacy compatibility — read-only",
    },
  };
}

export type AccountFollowLimitProjection = ReturnType<typeof buildAccountFollowLimitProjection>;
