export type AuthUserLocale = "fr" | "en";

export const DEFAULT_AUTH_USER_LOCALE: AuthUserLocale = "fr";

export function isAuthUserLocale(value: unknown): value is AuthUserLocale {
  return value === "fr" || value === "en";
}

export function resolveAuthUserLocale(value: unknown): AuthUserLocale {
  if (typeof value !== "string") return DEFAULT_AUTH_USER_LOCALE;
  const normalized = value.trim().toLowerCase();
  return isAuthUserLocale(normalized) ? normalized : DEFAULT_AUTH_USER_LOCALE;
}

export function resolveAuthLocaleBackfill(input: {
  currentLocale: unknown;
  linkedClientLocales: unknown[];
}) {
  if (isAuthUserLocale(input.currentLocale)) {
    return {
      needsUpdate: false as const,
      locale: input.currentLocale,
      source: "existing_auth_metadata" as const,
    };
  }

  const knownLocales = [...new Set(input.linkedClientLocales.filter(isAuthUserLocale))];
  if (knownLocales.length === 1) {
    return {
      needsUpdate: true as const,
      locale: knownLocales[0],
      source: "client_preferred_language" as const,
    };
  }

  return {
    needsUpdate: true as const,
    locale: DEFAULT_AUTH_USER_LOCALE,
    source: "temporary_fr_fallback" as const,
  };
}
