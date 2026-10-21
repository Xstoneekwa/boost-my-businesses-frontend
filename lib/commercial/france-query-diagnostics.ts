export type FranceQueryDiagnostic = { query: string; page: number; status: number | null; category: string;
  observed_at?: string; provider_error_code?: string | null; provider_error_type?: string | null; request_id?: string | null };
const safeDiagnosticCode = (value: unknown) => typeof value === "string" && /^[a-z0-9_.:-]{1,96}$/i.test(value)
  && !/(?:sk[-_]|secret|token|password|authorization|api[-_]?key)/i.test(value) ? value : null;
export function franceSemanticSerpCounters(diagnostics: FranceQueryDiagnostic[]) {
  const count = (category: string) => diagnostics.filter(d => d.category === category).length;
  const empty = count("ZERO_RESULTS"); const ok = count("OK"); const timeouts = count("TIMEOUT");
  return { attempts: diagnostics.length, transport_http_2xx: diagnostics.filter(d => d.status !== null && d.status >= 200 && d.status < 300).length,
    serp_ok: ok, provider_error_payload: count("PROVIDER_ERROR_PAYLOAD"), timeout: timeouts, empty,
    provider_errors: diagnostics.length - ok - empty - timeouts };
}
/** Observability only. Forward the same request/response; no retries or changed provider semantics. */
export function franceDiagnosticFetcher(fetcher: typeof fetch, diagnostics: FranceQueryDiagnostic[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const base = { query: url.searchParams.get("q") ?? "", page: Number(url.searchParams.get("page") ?? "1") };
    try {
      const response = await fetcher(input, init);
      let category = response.ok ? "OK" : response.status === 429 ? "RATE_LIMITED" : "PROVIDER_HTTP_ERROR";
      let provider_error_code = null, provider_error_type = null;
      let request_id = safeDiagnosticCode(response.headers.get("x-request-id") ?? response.headers.get("request-id"));
      try {
          const body = await response.clone().json();
          provider_error_code = safeDiagnosticCode(body?.error?.code ?? body?.error_code);
          provider_error_type = safeDiagnosticCode(body?.error?.type ?? body?.error_type);
          request_id ??= safeDiagnosticCode(body?.search_metadata?.id);
          if (response.ok && (body?.error || body?.errors)) category = "PROVIDER_ERROR_PAYLOAD";
          else if (response.ok) {
            const rows = body?.organic_results ?? body?.results ?? body?.items;
            category = Array.isArray(rows) ? rows.length ? "OK" : "ZERO_RESULTS" : "UNKNOWN_EMPTY_RESPONSE";
          }
      } catch { if (response.ok) category = "MALFORMED_JSON"; }
      diagnostics.push({ ...base, status: response.status, category, provider_error_code, provider_error_type,
        request_id, observed_at: new Date().toISOString() });
      return response;
    } catch (error) {
      diagnostics.push({ ...base, status: null, category: error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "TIMEOUT" : "NETWORK_OR_PROVIDER_ERROR", observed_at: new Date().toISOString() });
      throw error;
    }
  };
}
