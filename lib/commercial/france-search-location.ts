/** Search targeting only. Never establishment, Instagram or V2 location evidence.
 * Contract: https://www.searchapi.io/docs/locations-api
 */
export type FranceSearchLocationFailure = "UNKNOWN_LOCATION" | "AMBIGUOUS_LOCATION" | "LOCATION_RESOLUTION_UNAVAILABLE";
export type FranceSearchLocationDiagnostic = {
  COUNTRY: "FR"; REQUESTED_CITY: string; SEARCH_LOCATION: string | null; GL: "fr"; HL: "fr";
  LOCATION_API_CALLS: number; LOCATION_HTTP_STATUS: number | null;
  LOCATION_RESOLUTION: "RESOLVED" | FranceSearchLocationFailure; LOCATION_TIMEOUT: boolean;
};
type Resolution = { ok: true; canonicalName: string; diagnostic: FranceSearchLocationDiagnostic }
  | { ok: false; reason: FranceSearchLocationFailure; diagnostic: FranceSearchLocationDiagnostic };

// Deliberately limited equivalence: case, accents, apostrophe/hyphen typography
// and separator whitespace. No token reordering, abbreviation or fuzzy matching.
export function normalizeFranceSearchCity(value: string) {
  return value.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr")
    .replace(/[’‘]/g, "'").replace(/[\p{Pd}\s]+/gu, " ").trim();
}
const row = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Unique among admissible returned locations, never the provider's popularity order.
 * A full100-result response is potentially truncated and cannot prove uniqueness.
 */
export function selectFranceSearchLocation(city: string, payload: unknown): { canonicalName: string } | { reason: FranceSearchLocationFailure } {
  if (!Array.isArray(payload)) return { reason: "LOCATION_RESOLUTION_UNAVAILABLE" };
  const requested = normalizeFranceSearchCity(city);
  const matches = payload.map(row).filter(r => {
    if (r.country_code !== "FR" || !["City", "Municipality"].includes(String(r.target_type))) return false;
    if (typeof r.name !== "string" || normalizeFranceSearchCity(r.name) !== requested) return false;
    if (typeof r.canonical_name !== "string" || r.canonical_name.length > 256
      || !/^[\p{L}\p{M}\p{N},.'’() \p{Pd}]+$/u.test(r.canonical_name)) return false;
    const parts = r.canonical_name.split(",").map(p => p.trim());
    return parts.length >= 2 && parts.every(Boolean) && normalizeFranceSearchCity(parts[0]) === requested
      && parts.at(-1)?.toLocaleLowerCase("fr") === "france";
  });
  if (matches.length > 1) return { reason: "AMBIGUOUS_LOCATION" };
  if (payload.length >= 100) return { reason: "LOCATION_RESOLUTION_UNAVAILABLE" };
  if (!matches.length) return { reason: "UNKNOWN_LOCATION" };
  return { canonicalName: String(matches[0].canonical_name).trim() };
}

/** One bounded lookup per discovery invocation/run reservation, before its query loop.
 * The existing discovery reservation rejects replay before this function is reached.
 * No retry, per-candidate lookup, cross-run cache or commercial ledger consumption.
 */
export async function resolveFranceSearchLocation(input: { city: string; apiKey: string; fetcher: typeof fetch }): Promise<Resolution> {
  const city = input.city.trim();
  const diagnostic: FranceSearchLocationDiagnostic = { COUNTRY: "FR", REQUESTED_CITY: city.slice(0, 76), SEARCH_LOCATION: null,
    GL: "fr", HL: "fr", LOCATION_API_CALLS: 0, LOCATION_HTTP_STATUS: null,
    LOCATION_RESOLUTION: "LOCATION_RESOLUTION_UNAVAILABLE", LOCATION_TIMEOUT: false };
  const failure = (reason: FranceSearchLocationFailure): Resolution => ({ ok: false, reason, diagnostic: { ...diagnostic, LOCATION_RESOLUTION: reason } });
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '’\p{Pd}]{1,75}$/u.test(city)) return failure("UNKNOWN_LOCATION");
  if (!input.apiKey.trim()) return failure("LOCATION_RESOLUTION_UNAVAILABLE");
  const url = new URL("https://www.searchapi.io/api/v1/locations");
  url.searchParams.set("q", city); url.searchParams.set("limit", "100");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    diagnostic.LOCATION_API_CALLS = 1;
    // The key is not in the location URL. No headers, raw payload or provider
    // message are copied to the allowlisted run diagnostic.
    const response = await input.fetcher(url.toString(), { method: "GET", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${input.apiKey}` }, signal: controller.signal });
    diagnostic.LOCATION_HTTP_STATUS = response.status;
    if (!response.ok) return failure("LOCATION_RESOLUTION_UNAVAILABLE");
    const selected = selectFranceSearchLocation(city, await response.json());
    if ("reason" in selected) return failure(selected.reason);
    if (selected.canonicalName.includes(input.apiKey)) return failure("LOCATION_RESOLUTION_UNAVAILABLE");
    return { ok: true, canonicalName: selected.canonicalName,
      diagnostic: { ...diagnostic, SEARCH_LOCATION: selected.canonicalName, LOCATION_RESOLUTION: "RESOLVED" } };
  } catch (error) {
    diagnostic.LOCATION_TIMEOUT = controller.signal.aborted || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
    return failure("LOCATION_RESOLUTION_UNAVAILABLE");
  } finally { clearTimeout(timer); }
}

/** The exact low-level HTTP request is forwarded with only the FR geo block added.
 * q, page, device/defaults, deadline, extraction and early-stop remain untouched.
 */
export function franceLocalizedSearchFetcher(fetcher: typeof fetch, resolution: Extract<Resolution, { ok: true }>): typeof fetch {
  return (input, init) => {
    const url = new URL(String(input));
    url.searchParams.set("location", resolution.canonicalName);
    url.searchParams.set("gl", "fr"); url.searchParams.set("hl", "fr");
    return fetcher(url.toString(), init);
  };
}
