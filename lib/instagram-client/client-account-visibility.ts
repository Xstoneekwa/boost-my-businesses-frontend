const TERMINAL_ACCOUNT_LIFECYCLE_STATES = new Set([
  "archived",
  "trashed",
  "cancelled",
  "canceled",
  "deleted",
  "rolled_back_test_onboarding",
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
