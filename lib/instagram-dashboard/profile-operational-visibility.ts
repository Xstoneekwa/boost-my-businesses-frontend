export type OperationalProfileLifecycle = "active" | "archived" | "trashed" | "inactive";

export type OperationalProfileRow = {
  active?: unknown;
  clientActive?: unknown;
  client_active?: unknown;
  accountLifecycleStatus?: unknown;
  account_lifecycle_status?: unknown;
  lifecycleStatus?: unknown;
  lifecycle_status?: unknown;
  adminStatus?: unknown;
  admin_status?: unknown;
  admin_lifecycle_status?: unknown;
  accountStatus?: unknown;
  status?: unknown;
  state?: unknown;
  archivedAt?: unknown;
  archived_at?: unknown;
  deletedAt?: unknown;
  deleted_at?: unknown;
  tombstonedAt?: unknown;
  tombstoned_at?: unknown;
  trashedAt?: unknown;
  trashed_at?: unknown;
};

const TERMINAL_STATUSES = new Set([
  "cancelled",
  "canceled",
  "deleted",
  "onboarding_rollback",
  "rolled_back",
  "rolled_back_test_onboarding",
  "tombstone",
  "tombstoned",
]);

const RUNTIME_INACTIVE_STATUSES = new Set(["inactive", "deactivated"]);
const ARCHIVED_STATUSES = new Set(["archived"]);
const TRASHED_STATUSES = new Set(["trash", "trashed"]);

const ACCOUNT_LIFECYCLE_FIELDS = [
  "accountLifecycleStatus",
  "account_lifecycle_status",
  "lifecycleStatus",
  "lifecycle_status",
] as const;

const ADMIN_LIFECYCLE_FIELDS = [
  "adminStatus",
  "admin_status",
  "admin_lifecycle_status",
] as const;

const FALLBACK_LIFECYCLE_FIELDS = ["accountStatus", "status", "state"] as const;
const ARCHIVED_TIMESTAMP_FIELDS = ["archivedAt", "archived_at"] as const;
const TRASHED_TIMESTAMP_FIELDS = ["trashedAt", "trashed_at"] as const;
const TERMINAL_TIMESTAMP_FIELDS = ["deletedAt", "deleted_at", "tombstonedAt", "tombstoned_at"] as const;

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function statuses(row: OperationalProfileRow, fields: readonly (keyof OperationalProfileRow)[]) {
  return fields.map((field) => normalized(row[field])).filter(Boolean);
}

function hasTimestamp(row: OperationalProfileRow, fields: readonly (keyof OperationalProfileRow)[]) {
  return fields.some((field) => Boolean(row[field]));
}

export function classifyOperationalProfileLifecycle(row: OperationalProfileRow): OperationalProfileLifecycle {
  const accountStatuses = statuses(row, ACCOUNT_LIFECYCLE_FIELDS);
  const adminStatuses = statuses(row, ADMIN_LIFECYCLE_FIELDS);
  const fallbackStatuses = statuses(row, FALLBACK_LIFECYCLE_FIELDS);
  const allStatuses = [...accountStatuses, ...adminStatuses, ...fallbackStatuses];

  if (hasTimestamp(row, ARCHIVED_TIMESTAMP_FIELDS) || allStatuses.some((status) => ARCHIVED_STATUSES.has(status))) {
    return "archived";
  }
  if (hasTimestamp(row, TRASHED_TIMESTAMP_FIELDS) || allStatuses.some((status) => TRASHED_STATUSES.has(status))) {
    return "trashed";
  }
  if (hasTimestamp(row, TERMINAL_TIMESTAMP_FIELDS) || allStatuses.some((status) => TERMINAL_STATUSES.has(status))) {
    return "inactive";
  }
  if (row.active === false || row.clientActive === false || row.client_active === false) {
    return "inactive";
  }

  const hasRuntimeInactiveStatus = allStatuses.some((status) => RUNTIME_INACTIVE_STATUSES.has(status));
  const hasExplicitNonterminalLifecycle = [...accountStatuses, ...adminStatuses].some((status) => {
    return !RUNTIME_INACTIVE_STATUSES.has(status);
  });
  if (hasRuntimeInactiveStatus && !hasExplicitNonterminalLifecycle) return "inactive";

  return "active";
}

export function isOperationalProfileVisible(row: OperationalProfileRow) {
  return classifyOperationalProfileLifecycle(row) === "active";
}

export const operationalTerminalStatuses = Object.freeze([...TERMINAL_STATUSES]);
