export type ParsedClientApiResponse<T = Record<string, unknown>> = {
  ok: boolean;
  status?: string;
  code?: string;
  message?: string;
  error?: string;
  reason?: string;
  client_readiness_status?: string;
  data?: T;
};

export function clientSafeEmptyBodyMessage(lang: "fr" | "en" = "fr") {
  return lang === "fr"
    ? "La connexion n'a pas pu être lancée pour le moment."
    : "Connection could not be started right now.";
}

export function clientSafeInvalidBodyMessage(lang: "fr" | "en" = "fr") {
  return lang === "fr"
    ? "Réponse serveur indisponible. Réessayez dans quelques instants."
    : "Server response unavailable. Try again in a moment.";
}

export async function parseClientApiResponse<T = Record<string, unknown>>(
  response: Response,
  lang: "fr" | "en" = "fr",
): Promise<ParsedClientApiResponse<T>> {
  const fallback = clientSafeEmptyBodyMessage(lang);
  const text = await response.text();
  if (!text.trim()) {
    return {
      ok: false,
      status: "not_created",
      message: fallback,
      error: fallback,
    };
  }
  try {
    const payload = JSON.parse(text) as ParsedClientApiResponse<T>;
    if (!payload || typeof payload !== "object") {
      return {
        ok: false,
        status: "not_created",
        message: clientSafeInvalidBodyMessage(lang),
        error: clientSafeInvalidBodyMessage(lang),
      };
    }
    return payload;
  } catch {
    return {
      ok: false,
      status: "not_created",
      message: clientSafeInvalidBodyMessage(lang),
      error: clientSafeInvalidBodyMessage(lang),
    };
  }
}
