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
export function selectFranceSearchLocation(city: string, payload: unknown, clarified = false): { canonicalName: string } | { reason: FranceSearchLocationFailure } {
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
  const distinct = new Map<string, Record<string, unknown>>();
  for (const [index, match] of matches.entries()) {
    const id = String(match.google_id ?? "");
    const identified = /^[1-9][0-9]{0,19}$/.test(id)
      && (typeof match.google_id === "string" || Number.isSafeInteger(match.google_id));
    if (clarified && (!identified || String(match.canonical_name).split(",").length < 3))
      return { reason: "LOCATION_RESOLUTION_UNAVAILABLE" };
    // Missing IDs do not prove duplicate identity. Conflicting rows for the
    // same ID also fail closed; never select the first/most popular location.
    const key = identified ? `id:${id}` : `row:${index}`;
    const previous = distinct.get(key);
    if (previous && normalizeFranceSearchCity(String(previous.canonical_name)) !== normalizeFranceSearchCity(String(match.canonical_name)))
      return { reason: "AMBIGUOUS_LOCATION" };
    if (!previous || String(match.canonical_name) < String(previous.canonical_name)) distinct.set(key, match);
  }
  if (distinct.size > 1) return { reason: "AMBIGUOUS_LOCATION" };
  if (payload.length >= 100) return { reason: "LOCATION_RESOLUTION_UNAVAILABLE" };
  if (!distinct.size) return { reason: "UNKNOWN_LOCATION" };
  return { canonicalName: String(distinct.values().next().value!.canonical_name).trim() };
}

/** One initial lookup and at most one saturation clarification per run reservation.
 * The existing discovery reservation rejects replay before this function is reached.
 * Both share the existing8000ms deadline. No retry, per-candidate lookup, cross-run
 * cache or commercial ledger consumption. Uniqueness is within the admissible
 * returned set only, not a claim of national geographic uniqueness.
 */
export async function resolveFranceSearchLocation(input: { city: string; apiKey: string; fetcher: typeof fetch }): Promise<Resolution> {
  const city = input.city.trim();
  const diagnostic: FranceSearchLocationDiagnostic = { COUNTRY: "FR", REQUESTED_CITY: city.slice(0, 76), SEARCH_LOCATION: null,
    GL: "fr", HL: "fr", LOCATION_API_CALLS: 0, LOCATION_HTTP_STATUS: null,
    LOCATION_RESOLUTION: "LOCATION_RESOLUTION_UNAVAILABLE", LOCATION_TIMEOUT: false };
  const failure = (reason: FranceSearchLocationFailure): Resolution => ({ ok: false, reason, diagnostic: { ...diagnostic, LOCATION_RESOLUTION: reason } });
  if (!/^[\p{L}\p{M}][\p{L}\p{M} '’\p{Pd}]{1,75}$/u.test(city)) return failure("UNKNOWN_LOCATION");
  if (!input.apiKey.trim()) return failure("LOCATION_RESOLUTION_UNAVAILABLE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  const lookup = async (query: string) => {
    if (controller.signal.aborted) throw new DOMException("Location deadline", "AbortError");
    const url = new URL("https://www.searchapi.io/api/v1/locations");
    url.searchParams.set("q", query); url.searchParams.set("limit", "100");
    diagnostic.LOCATION_API_CALLS += 1;
    diagnostic.LOCATION_HTTP_STATUS = null;
    // No key in the URL, raw payload, headers or provider error persisted.
    const response = await input.fetcher(url.toString(), { method: "GET", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${input.apiKey}` }, signal: controller.signal });
    diagnostic.LOCATION_HTTP_STATUS = response.status;
    return response.ok ? response.json() : null;
  };
  try {
    const payload = await lookup(city);
    let selected = selectFranceSearchLocation(city, payload);
    if (Array.isArray(payload) && payload.length === 100
      && !("reason" in selected && selected.reason === "AMBIGUOUS_LOCATION")) {
      // Derive only from the caller's validated city and FR country, never a
      // returned candidate/region. A second saturated response stays refused.
      selected = selectFranceSearchLocation(city, await lookup(`${city}, France`), true);
    }
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
