import {
  normalizeProtectionUsernameEntries,
} from "./account-protection-list-input.ts";

export {
  normalizeProtectionUsername,
  normalizeProtectionUsernameEntries,
  type UsernameEntryError,
  type UsernameEntryErrorCode,
} from "./account-protection-list-input.ts";

export const ACCOUNT_PROTECTION_LIST_KINDS = [
  "interaction_blacklist",
  "unfollow_whitelist",
] as const;

export type AccountProtectionListKind = (typeof ACCOUNT_PROTECTION_LIST_KINDS)[number];
export type AccountProtectionListOperation = "replace" | "patch" | "delete";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAccountProtectionListKind(value: string): value is AccountProtectionListKind {
  return ACCOUNT_PROTECTION_LIST_KINDS.includes(value as AccountProtectionListKind);
}

export function isCanonicalAccountId(value: string) {
  return uuidPattern.test(value);
}

export function accountProtectionListsEnabled() {
  return process.env.ACCOUNT_PROTECTION_LISTS_V1_ENABLED !== "false";
}

export function normalizeProtectionPatch(addValue: unknown, removeValue: unknown) {
  const add = normalizeProtectionUsernameEntries(addValue ?? [], "add");
  const remove = normalizeProtectionUsernameEntries(removeValue ?? [], "remove");
  const errors = [...add.errors, ...remove.errors];
  const addSet = new Set(add.items);
  remove.items.forEach((username, index) => {
    if (addSet.has(username)) {
      errors.push({ field: "remove", index, input: username, code: "duplicate_input" });
    }
  });
  return { add: add.items, remove: remove.items, errors };
}

export function accountProtectionListEtag(
  accountId: string,
  listKind: AccountProtectionListKind,
  version: number,
) {
  return `"apl:${accountId}:${listKind}:v${version}"`;
}

export function readExpectedVersion(
  ifMatch: string | null,
  accountId: string,
  listKind: AccountProtectionListKind,
) {
  if (!ifMatch) return { ok: false as const, status: 428, error: "if_match_required" };
  const validator = ifMatch.trim().replace(/^W\//, "");
  const prefix = `"apl:${accountId}:${listKind}:v`;
  if (!validator.startsWith(prefix) || !validator.endsWith('"')) {
    return { ok: false as const, status: 400, error: "invalid_if_match" };
  }
  const rawVersion = validator.slice(prefix.length, -1);
  const version = Number(rawVersion);
  if (!/^\d+$/.test(rawVersion) || !Number.isSafeInteger(version) || version < 0) {
    return { ok: false as const, status: 400, error: "invalid_if_match" };
  }
  return { ok: true as const, version };
}

export function accountProtectionMutationBlocked(account: Record<string, unknown>) {
  const status = String(account.status ?? "").trim().toLowerCase();
  const lifecycle = String(account.admin_lifecycle_status ?? "").trim().toLowerCase();
  return Boolean(account.archived_at || account.trashed_at)
    || ["archived", "trashed", "cancelled", "canceled", "deleted"].includes(status)
    || ["archived", "trashed", "cancelled", "canceled", "deleted"].includes(lifecycle);
}

export function buildAccountProtectionListSnapshot(
  rawItems: unknown[],
  version: number,
  updatedAt: string | null,
) {
  const items = rawItems.map((item) => String(item)).filter(Boolean).sort();
  return {
    items,
    size: items.length,
    version,
    updatedAt,
    status: items.length ? "loaded_with_items" as const : "loaded_empty" as const,
  };
}
