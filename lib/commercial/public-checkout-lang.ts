export type PublicCheckoutLang = "fr" | "en";

export const PUBLIC_CHECKOUT_LANG_STORAGE_KEY = "bmb_lang";

export function resolvePublicCheckoutLangFromSearchParam(
  value: string | null | undefined,
): PublicCheckoutLang | null {
  if (value === "en" || value === "fr") return value;
  return null;
}

export function readPublicCheckoutLangFromStorage(): PublicCheckoutLang | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(PUBLIC_CHECKOUT_LANG_STORAGE_KEY);
    if (stored === "en" || stored === "fr") return stored;
  } catch {
    return null;
  }
  return null;
}

export function resolvePublicCheckoutLang(input?: {
  searchParam?: string | null;
  fallback?: PublicCheckoutLang;
}): PublicCheckoutLang {
  return resolvePublicCheckoutLangFromSearchParam(input?.searchParam)
    ?? readPublicCheckoutLangFromStorage()
    ?? input?.fallback
    ?? "fr";
}

export function publicCheckoutLoginPath(lang: PublicCheckoutLang) {
  return lang === "en" ? "/instagram-login?lang=en" : "/instagram-login";
}
