export type ProfileLifecycleRow = Record<string, unknown>;

const TERMINAL_LIFECYCLE_STATUSES = new Set([
  "archived",
  "cancelled",
  "canceled",
  "deleted",
  "onboarding_rollback",
  "rolled_back",
  "rolled_back_test_onboarding",
  "tombstone",
  "tombstoned",
  "trash",
  "trashed",
]);

const ACCOUNT_LIFECYCLE_STATUS_FIELDS = [
  "accountLifecycleStatus",
  "account_lifecycle_status",
  "lifecycleStatus",
  "lifecycle_status",
] as const;

const ADMIN_LIFECYCLE_STATUS_FIELDS = [
  "adminStatus",
  "admin_lifecycle_status",
] as const;

const FALLBACK_LIFECYCLE_STATUS_FIELDS = [
  "accountStatus",
  "status",
  "state",
] as const;

const TERMINAL_TIMESTAMP_FIELDS = [
  "archivedAt",
  "archived_at",
  "deletedAt",
  "deleted_at",
  "tombstonedAt",
  "tombstoned_at",
  "trashedAt",
  "trashed_at",
] as const;

function isRow(value: unknown): value is ProfileLifecycleRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function unwrapJsonOkData(value: unknown): ProfileLifecycleRow {
  if (!isRow(value)) return {};
  return isRow(value.data) ? value.data : value;
}

function normalizedStatus(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isCanonicalVisibleProfile(row: ProfileLifecycleRow) {
  const accountLifecycleStatuses = ACCOUNT_LIFECYCLE_STATUS_FIELDS
    .map((field) => normalizedStatus(row[field]))
    .filter(Boolean);
  const adminLifecycleStatuses = ADMIN_LIFECYCLE_STATUS_FIELDS
    .map((field) => normalizedStatus(row[field]))
    .filter(Boolean);
  const lifecycleStatuses = accountLifecycleStatuses.length
    ? accountLifecycleStatuses
    : adminLifecycleStatuses.length
      ? adminLifecycleStatuses
      : FALLBACK_LIFECYCLE_STATUS_FIELDS.map((field) => normalizedStatus(row[field])).filter(Boolean);
  const hasTerminalStatus = lifecycleStatuses.some((status) => {
    return TERMINAL_LIFECYCLE_STATUSES.has(status);
  });
  if (hasTerminalStatus) return false;

  return !TERMINAL_TIMESTAMP_FIELDS.some((field) => Boolean(row[field]));
}

export function selectCanonicalVisibleProfiles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRow).filter(isCanonicalVisibleProfile);
}
