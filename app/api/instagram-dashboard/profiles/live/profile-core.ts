type Row = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function profileAccountId(row: Row) {
  return text(row.accountId) || text(row.account_id) || text(row.id);
}

export function mergeCanonicalProfilesWithRuntime(baseProfiles: Row[], runtimeProfiles: Row[]) {
  const runtimeByAccount = new Map(
    runtimeProfiles
      .map((row) => [profileAccountId(row), row] as const)
      .filter(([accountId]) => Boolean(accountId)),
  );
  return baseProfiles.map((profile) => ({
    ...profile,
    ...(runtimeByAccount.get(profileAccountId(profile)) ?? {}),
  }));
}

export function missingRuntimeAccountIds(baseProfiles: Row[], runtimeProfiles: Row[]) {
  const projected = new Set(runtimeProfiles.map(profileAccountId).filter(Boolean));
  return baseProfiles.map(profileAccountId).filter((accountId) => accountId && !projected.has(accountId));
}

export function canonicalRuntimeFallbackProfiles(baseProfiles: Row[], runtimeProfiles: Row[]) {
  const runtimeByAccount = new Map(runtimeProfiles.map((row) => [profileAccountId(row), row]));
  return baseProfiles.filter((profile) => {
    const packageLabel = text(profile.packageLabel || profile.package_label).toLowerCase();
    if (!packageLabel.includes("premium") && !packageLabel.includes("pro")) return false;
    const runtime = runtimeByAccount.get(profileAccountId(profile));
    return runtime ? !text(runtime.capsSource).includes("account_package_summary") : false;
  });
}

export function replaceRuntimeProfiles(runtimeProfiles: Row[], replacements: Row[]) {
  const replacementByAccount = new Map(replacements.map((row) => [profileAccountId(row), row]));
  const retained = runtimeProfiles.filter((row) => !replacementByAccount.has(profileAccountId(row)));
  return [...retained, ...replacements];
}
