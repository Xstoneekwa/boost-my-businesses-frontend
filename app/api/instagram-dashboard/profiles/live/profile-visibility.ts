import { isOperationalProfileVisible } from "../../../../../lib/instagram-dashboard/profile-operational-visibility.ts";

export type ProfileLifecycleRow = Record<string, unknown>;

function isRow(value: unknown): value is ProfileLifecycleRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function unwrapJsonOkData(value: unknown): ProfileLifecycleRow {
  if (!isRow(value)) return {};
  return isRow(value.data) ? value.data : value;
}

export function isCanonicalVisibleProfile(row: ProfileLifecycleRow) {
  return isOperationalProfileVisible(row);
}

export function selectCanonicalVisibleProfiles(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRow).filter(isCanonicalVisibleProfile);
}

export function canonicalProfilesMembership(payload: ProfileLifecycleRow, requestedIds: string[]) {
  const ledger = payload.profiles;
  const active = payload.activeAccounts;
  const revision = payload.projection_revision;
  const id = (row: ProfileLifecycleRow) => String(row.accountId || row.account_id || row.id || "");
  if (!Array.isArray(ledger) || !Array.isArray(active) || !Array.isArray(payload.errors) || payload.errors.length
    || typeof revision !== "string" || !Number.isFinite(Date.parse(revision))) return undefined;
  for (const rows of [ledger, active]) {
    if (rows.some(row => !isRow(row) || !id(row)) || new Set(rows.map(id)).size !== rows.length) return undefined;
  }
  const visible = selectCanonicalVisibleProfiles(ledger).map(id).sort();
  const activeIds = active.map(id).sort();
  if (JSON.stringify(visible) !== JSON.stringify(activeIds)) return undefined;
  // Absence is not a lifecycle event, even in an apparently complete response.
  // Only a present canonical row explicitly excluded by lifecycle is removal proof.
  const excluded = new Set(ledger.filter(row => !isCanonicalVisibleProfile(row)).map(id));
  return { schema: "profiles_membership_v1", revision,
    removedAccountIds: [...new Set(requestedIds)].filter(key => excluded.has(key)) };
}
