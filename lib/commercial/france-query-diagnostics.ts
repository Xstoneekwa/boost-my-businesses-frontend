export type FranceQueryDiagnostic = { query: string; page: number; status: number | null; category: string };
/** Observability only. Forward the same request/response; no retries or changed provider semantics. */
export function franceDiagnosticFetcher(fetcher: typeof fetch, diagnostics: FranceQueryDiagnostic[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const base = { query: url.searchParams.get("q") ?? "", page: Number(url.searchParams.get("page") ?? "1") };
    try {
      const response = await fetcher(input, init);
      let category = response.ok ? "OK" : response.status === 429 ? "RATE_LIMITED" : "PROVIDER_HTTP_ERROR";
      if (response.ok) {
        try {
          const body = await response.clone().json();
          if (body?.error || body?.errors) category = "PROVIDER_ERROR_PAYLOAD";
          else {
            const rows = body?.organic_results ?? body?.results ?? body?.items;
            category = Array.isArray(rows) ? rows.length ? "OK" : "ZERO_RESULTS" : "UNKNOWN_EMPTY_RESPONSE";
          }
        } catch { category = "MALFORMED_JSON"; }
      }
      diagnostics.push({ ...base, status: response.status, category });
      return response;
    } catch (error) {
      diagnostics.push({ ...base, status: null, category: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_OR_PROVIDER_ERROR" });
      throw error;
    }
  };
}
