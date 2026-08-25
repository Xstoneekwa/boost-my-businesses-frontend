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
