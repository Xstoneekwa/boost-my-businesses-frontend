export type CanonicalClientAccountVisibilitySeed = {
  accountId: string;
  clientId: string | null;
  label: string | null;
  active: boolean;
  onboardingRollbackAt: string | null;
  loginStatus: string | null;
  provisioningStatus: string | null;
  onboardingStatus: string | null;
  createdAt: string | null;
};

export type CanonicalIgAccountVisibilitySeed = {
  accountId: string;
  username: string | null;
  displayName: string | null;
  status: string | null;
  adminLifecycleStatus: string | null;
  deviceName: string | null;
  createdAt: string | null;
};

export type CanonicalManageVisibilityRow = {
  account_id: string;
  client_id: string | null;
  client_name: string | null;
  username: string;
  status: string;
  admin_lifecycle_status: string;
  login_status: string;
  provisioning_status: string;
  onboarding_status: string;
  phone_name: string | null;
  created_at: string | null;
};

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isRolledBackAccount(account: CanonicalIgAccountVisibilitySeed) {
  const status = normalized(account.status);
  const username = normalized(account.username);
  return status === "rolled_back_test_onboarding"
    || status === "onboarding_rollback"
    || username.startsWith("rb_test_");
}

/**
 * Builds sparse rows only for canonical active client accounts missing from the
 * manage_overview snapshot. Existing rows always win and later enrichment is
 * responsible for assignment, package, credentials and readiness projections.
 */
export function missingCanonicalClientAccountVisibilityRows(input: {
  existingAccountIds: Iterable<string>;
  clientAccounts: CanonicalClientAccountVisibilitySeed[];
  igAccounts: CanonicalIgAccountVisibilitySeed[];
}): CanonicalManageVisibilityRow[] {
  const existing = new Set([...input.existingAccountIds].map((value) => normalized(value)).filter(Boolean));
  const igByAccountId = new Map(
    input.igAccounts
      .filter((account) => account.accountId.trim())
      .map((account) => [normalized(account.accountId), account] as const),
  );
  const emitted = new Set<string>();
  const rows: CanonicalManageVisibilityRow[] = [];

  for (const clientAccount of input.clientAccounts) {
    const accountId = clientAccount.accountId.trim();
    const accountKey = normalized(accountId);
    if (!accountKey || existing.has(accountKey) || emitted.has(accountKey)) continue;
    if (!clientAccount.active || clientAccount.onboardingRollbackAt) continue;

    const account = igByAccountId.get(accountKey);
    if (!account || isRolledBackAccount(account)) continue;

    rows.push({
      account_id: accountId,
      client_id: clientAccount.clientId,
      client_name: clientAccount.label,
      username: account.username?.trim() || clientAccount.label?.trim() || "Unknown",
      status: account.status?.trim() || "inactive",
      admin_lifecycle_status: account.adminLifecycleStatus?.trim() || "active",
      login_status: clientAccount.loginStatus?.trim() || "unknown",
      provisioning_status: clientAccount.provisioningStatus?.trim() || "unknown",
      onboarding_status: clientAccount.onboardingStatus?.trim() || "unknown",
      phone_name: account.deviceName,
      created_at: clientAccount.createdAt ?? account.createdAt,
    });
    emitted.add(accountKey);
  }

  return rows;
}
