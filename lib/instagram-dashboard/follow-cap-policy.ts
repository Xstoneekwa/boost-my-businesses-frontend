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

type JsonRecord = Record<string, unknown>;

function positiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
