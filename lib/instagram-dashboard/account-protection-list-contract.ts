export const ACCOUNT_PROTECTION_LIST_KINDS = [
  "interaction_blacklist",
  "unfollow_whitelist",
] as const;

export type AccountProtectionListKind = (typeof ACCOUNT_PROTECTION_LIST_KINDS)[number];
export type AccountProtectionListOperation = "replace" | "patch" | "delete";
export type UsernameEntryErrorCode =
  | "invalid_username"
  | "instagram_url_not_allowed"
  | "duplicate_input"
  | "empty_username";

export type UsernameEntryError = {
  field: "items" | "add" | "remove" | "username";
  index: number;
  input: string;
  code: UsernameEntryErrorCode;
};

const instagramUsernamePattern = /^[a-z0-9._]{1,30}$/;
const instagramUrlPattern = /(?:https?:\/\/|www\.|instagram\.com(?:\/|$)|\/)/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeInput(value: unknown) {
  if (typeof value !== "string") return String(value ?? "").slice(0, 80);
  return value.slice(0, 80);
}

export function isAccountProtectionListKind(value: string): value is AccountProtectionListKind {
  return ACCOUNT_PROTECTION_LIST_KINDS.includes(value as AccountProtectionListKind);
}

export function isCanonicalAccountId(value: string) {
  return uuidPattern.test(value);
}

export function accountProtectionListsEnabled() {
  return process.env.ACCOUNT_PROTECTION_LISTS_V1_ENABLED !== "false";
}

export function normalizeProtectionUsername(value: unknown) {
  if (typeof value !== "string") {
    return { ok: false as const, code: "invalid_username" as const, normalized: "" };
  }
  const trimmed = value.trim();
  if (!trimmed || /^@+$/.test(trimmed)) {
    return { ok: false as const, code: "empty_username" as const, normalized: "" };
  }
  if (instagramUrlPattern.test(trimmed)) {
    return { ok: false as const, code: "instagram_url_not_allowed" as const, normalized: "" };
  }
  const normalized = trimmed.replace(/^@+/, "").toLowerCase();
  if (
    !normalized
    || !instagramUsernamePattern.test(normalized)
    || normalized.startsWith(".")
    || normalized.endsWith(".")
    || normalized.includes("..")
  ) {
    return { ok: false as const, code: "invalid_username" as const, normalized };
  }
  return { ok: true as const, normalized };
}

export function normalizeProtectionUsernameEntries(
  values: unknown,
  field: UsernameEntryError["field"],
) {
  if (!Array.isArray(values)) {
    return {
      items: [] as string[],
      errors: [{ field, index: 0, input: safeInput(values), code: "invalid_username" as const }],
    };
  }
  const items: string[] = [];
  const errors: UsernameEntryError[] = [];
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const result = normalizeProtectionUsername(value);
    if (!result.ok) {
      errors.push({ field, index, input: safeInput(value), code: result.code });
      return;
    }
    if (seen.has(result.normalized)) {
      errors.push({ field, index, input: safeInput(value), code: "duplicate_input" });
      return;
    }
    seen.add(result.normalized);
    items.push(result.normalized);
  });
  items.sort();
  return { items, errors };
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
  const prefix = `"apl:${accountId}:${listKind}:v`;
  if (!ifMatch.startsWith(prefix) || !ifMatch.endsWith('"')) {
    return { ok: false as const, status: 400, error: "invalid_if_match" };
  }
  const rawVersion = ifMatch.slice(prefix.length, -1);
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
