const TERMINAL_ACCOUNT_LIFECYCLE_STATES = new Set([
  "archived",
  "trashed",
  "tombstoned",
  "cancelled",
  "canceled",
  "deleted",
  "rolled_back_test_onboarding",
  "onboarding_rollback",
]);

function normalizedStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isClientSelectableInstagramAccount(input: {
  adminLifecycleStatus?: unknown;
  status?: unknown;
}) {
  const adminLifecycleStatus = normalizedStatus(input.adminLifecycleStatus);
  if (adminLifecycleStatus) return !TERMINAL_ACCOUNT_LIFECYCLE_STATES.has(adminLifecycleStatus);
  return !TERMINAL_ACCOUNT_LIFECYCLE_STATES.has(normalizedStatus(input.status));
}

export function filterClientSelectableInstagramAccounts<
  T extends { admin_lifecycle_status?: unknown; status?: unknown },
>(rows: T[]) {
  return rows.filter((row) => isClientSelectableInstagramAccount({
    adminLifecycleStatus: row.admin_lifecycle_status,
    status: row.status,
  }));
}
