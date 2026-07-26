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

function safeInput(value: unknown) {
  if (typeof value !== "string") return String(value ?? "").slice(0, 80);
  return value.slice(0, 80);
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
      duplicateCount: 0,
    };
  }
  const items: string[] = [];
  const errors: UsernameEntryError[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  values.forEach((value, index) => {
    const result = normalizeProtectionUsername(value);
    if (!result.ok) {
      errors.push({ field, index, input: safeInput(value), code: result.code });
      return;
    }
    if (seen.has(result.normalized)) {
      duplicateCount += 1;
      return;
    }
    seen.add(result.normalized);
    items.push(result.normalized);
  });
  return { items, errors, duplicateCount };
}

export function parseProtectionListText(value: string, field: UsernameEntryError["field"] = "items") {
  const rawItems = value
    .split(/[,\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return normalizeProtectionUsernameEntries(rawItems, field);
}

export function protectionListEntryErrorMessage(code: string, lang: "fr" | "en" = "fr") {
  const french = lang === "fr";
  if (code === "instagram_url_not_allowed") {
    return french ? "Utilise uniquement le nom du compte, sans URL Instagram." : "Use only the account username, without an Instagram URL.";
  }
  if (code === "empty_username") {
    return french ? "Un nom de compte est vide." : "An account username is empty.";
  }
  return french
    ? "Un nom de compte est invalide. Utilise uniquement lettres, chiffres, points et underscores (30 caractères maximum)."
    : "An account username is invalid. Use only letters, numbers, dots, and underscores (30 characters maximum).";
}

export function protectionListRequestErrorMessage(code: string, lang: "fr" | "en" = "fr") {
  const french = lang === "fr";
  if (["version_conflict", "idempotency_conflict"].includes(code)) {
    return french ? "Ces listes ont été modifiées ailleurs. La dernière version vient d’être rechargée ; réessaie." : "These lists changed elsewhere. The latest version was reloaded; try again.";
  }
  if (["invalid_if_match", "if_match_required"].includes(code)) {
    return french ? "La version des listes n’a pas pu être vérifiée. Actualise l’étape puis réessaie." : "The list version could not be verified. Reload this step and try again.";
  }
  if (code === "invalid_entries" || code === "invalid_username") {
    return protectionListEntryErrorMessage("invalid_username", lang);
  }
  return french ? "Impossible d’enregistrer les listes de protection. Réessaie." : "Could not save the protection lists. Try again.";
}
