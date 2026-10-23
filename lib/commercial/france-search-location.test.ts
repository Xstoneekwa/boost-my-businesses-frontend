import assert from "node:assert/strict";
import test, { after } from "node:test";
import { normalizeFranceSearchCity, resolveFranceSearchLocation, selectFranceSearchLocation } from "./france-search-location.ts";

// Synthetic schema fixtures, NOT captured SearchAPI records, real google IDs or
// evidence that a particular town is supported live. Canonical value is used only
// when the provider actually advertises a unique admissible location at runtime.
const synthetic = (name: string, extra: Record<string, unknown> = {}) => ({ name, country_code: "FR", target_type: "City",
  canonical_name: `${name},Synthetic Test Region,France`, ...extra });
const key = "offline-fixture-only";
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("Unexpected live provider call"); };
after(() => { globalThis.fetch = originalFetch; });

for (const city of ["Paris", "Marseille", "Lyon", "Annecy", "Saint-Rémy-de-Provence"]) {
  test(`${city}: one exact FR City canonical, never a population choice`, async () => {
    let calls = 0;
    const selected = synthetic(city);
    const result = await resolveFranceSearchLocation({ city, apiKey: key, fetcher: async (input, init) => {
      calls++;
      const u = new URL(String(input));
      assert.equal(u.origin + u.pathname, "https://www.searchapi.io/api/v1/locations");
      assert.equal(u.searchParams.get("q"), city); assert.equal(u.searchParams.get("limit"), "100");
      assert.equal(u.searchParams.has("api_key"), false); assert.equal(init?.method, "GET");
      assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${key}`);
      return Response.json([synthetic(`${city} Region`, { target_type: "Region", reach: 999999999 }),
        synthetic(city, { country_code: "US", canonical_name: `${city},Texas,United States`, reach: 999999999 }), selected]);
    } });
    assert.equal(calls, 1); assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.canonicalName, selected.canonical_name);
    assert.deepEqual(result.diagnostic, { COUNTRY: "FR", REQUESTED_CITY: city, SEARCH_LOCATION: selected.canonical_name,
      GL: "fr", HL: "fr", LOCATION_API_CALLS: 1, LOCATION_HTTP_STATUS: 200, LOCATION_RESOLUTION: "RESOLVED", LOCATION_TIMEOUT: false });
  });
}
test("limited normalization supports accents/case/hyphen typography, not reordered or fuzzy names", () => {
  assert.equal(normalizeFranceSearchCity(" Saint–Rémy-de-Provence "), normalizeFranceSearchCity("saint remy de provence"));
  assert.equal(normalizeFranceSearchCity("L’Haÿ-les-Roses"), normalizeFranceSearchCity("L'Hay-les-Roses"));
  assert.deepEqual(selectFranceSearchLocation("Saint–Rémy-de-Provence", [synthetic("Saint-Remy-de-Provence")]),
    { canonicalName: "Saint-Remy-de-Provence,Synthetic Test Region,France" });
  assert.deepEqual(selectFranceSearchLocation("Paris", [synthetic("Pari")]), { reason: "UNKNOWN_LOCATION" });
  assert.deepEqual(selectFranceSearchLocation("Saint-Rémy-de-Provence", [synthetic("Provence Saint Rémy")]), { reason: "UNKNOWN_LOCATION" });
});
test("Municipality accepted, non-city target types rejected", () => {
  assert.ok("canonicalName" in selectFranceSearchLocation("Annecy", [synthetic("Annecy", { target_type: "Municipality" })]));
  for (const type of ["Region", "Department", "Country", "TV Region", "City Region", "Postal Code", "Neighborhood"])
    assert.deepEqual(selectFranceSearchLocation("Annecy", [synthetic("Annecy", { target_type: type })]), { reason: "UNKNOWN_LOCATION" });
});
test("homonymous French cities fail closed regardless of reach/order", () => {
  const locations = [synthetic("Saint-Martin", { canonical_name: "Saint-Martin,Synthetic Region A,France", reach: 100000 }),
    synthetic("Saint-Martin", { canonical_name: "Saint-Martin,Synthetic Region B,France", reach: 1 })];
  assert.deepEqual(selectFranceSearchLocation("Saint-Martin", locations), { reason: "AMBIGUOUS_LOCATION" });
  assert.deepEqual(selectFranceSearchLocation("Saint-Martin", locations.reverse()), { reason: "AMBIGUOUS_LOCATION" });
});
test("fictitious city or foreign homonym is UNKNOWN_LOCATION", () => {
  assert.deepEqual(selectFranceSearchLocation("VilleInventéeDiagnostic", []), { reason: "UNKNOWN_LOCATION" });
  assert.deepEqual(selectFranceSearchLocation("Paris", [synthetic("Paris", { country_code: "US", canonical_name: "Paris,Texas,United States" })]), { reason: "UNKNOWN_LOCATION" });
});
test("missing/incoherent/unsafe canonical names cannot authorize Google", () => {
  for (const canonical_name of [undefined, "", "Paris", "Lyon,Synthetic Region,France", "Paris,Texas,United States", "Paris,,France",
    "Paris,Synthetic\nRegion,France", "Paris,https://example.invalid/?api_key=fixture,France"])
    assert.deepEqual(selectFranceSearchLocation("Paris", [synthetic("Paris", { canonical_name })]), { reason: "UNKNOWN_LOCATION" });
});
test("malformed/error payload and potentially truncated100-row list cannot prove uniqueness", () => {
  for (const payload of [null, {}, { locations: [synthetic("Paris")] }, { error: "fixture" }])
    assert.deepEqual(selectFranceSearchLocation("Paris", payload), { reason: "LOCATION_RESOLUTION_UNAVAILABLE" });
  assert.deepEqual(selectFranceSearchLocation("Paris", [synthetic("Paris"), ...Array.from({ length: 99 }, (_, i) => synthetic(`Unrelated ${i}`))]), { reason: "LOCATION_RESOLUTION_UNAVAILABLE" });
});
for (const status of [400, 401, 403, 429, 500, 503]) test(`Locations HTTP${status}: explicit unavailability, no retry or error-body persistence`, async () => {
  let calls = 0;
  const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async () => {
    calls++; return Response.json({ error: { message: key }, Authorization: key }, { status });
  } });
  assert.equal(calls, 1); assert.equal(r.ok, false); assert.equal(r.diagnostic.LOCATION_RESOLUTION, "LOCATION_RESOLUTION_UNAVAILABLE");
  assert.equal(r.diagnostic.LOCATION_HTTP_STATUS, status); assert(!JSON.stringify(r).includes(key));
});
test("HTTP200 provider error or malformed JSON is unavailable, never resolved", async () => {
  for (const response of [Response.json({ error: { code: "fixture_error" } }), new Response("not json")]) {
    const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async () => response });
    assert.equal(r.ok, false); assert.equal(r.diagnostic.LOCATION_RESOLUTION, "LOCATION_RESOLUTION_UNAVAILABLE");
  }
});
test("8000ms Locations deadline, no retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0, aborted = false;
  const pending = resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async (_input, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => {
      aborted = true; reject(new DOMException("fixture", "AbortError"));
    }, { once: true }));
  } });
  t.mock.timers.tick(7999); assert.equal(aborted, false);
  t.mock.timers.tick(1);
  const r = await pending;
  assert.equal(calls, 1); assert.equal(r.ok, false); assert.equal(r.diagnostic.LOCATION_TIMEOUT, true);
  assert.equal(r.diagnostic.LOCATION_RESOLUTION, "LOCATION_RESOLUTION_UNAVAILABLE");
});
test("invalid syntax/unconfigured key make zero provider calls", async () => {
  let calls = 0;
  for (const city of ["", "Paris\nLyon", "Paris, USA", "https://fixture.invalid", "A".repeat(77)]) {
    const r = await resolveFranceSearchLocation({ city, apiKey: key, fetcher: async () => { calls++; throw Error("forbidden"); } });
    assert.equal(r.ok, false); assert.equal(r.diagnostic.LOCATION_RESOLUTION, "UNKNOWN_LOCATION");
  }
  const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: "", fetcher: async () => { calls++; throw Error("forbidden"); } });
  assert.equal(r.ok, false); assert.equal(calls, 0);
});
test("only a whitelist leaves memory; no API key, header, URL or full location row", async () => {
  const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async () => Response.json([
    synthetic("Paris", { api_key: key, Authorization: key, lat: 1, lon: 2, reach: 999, arbitrary: "unneeded" }),
  ]) });
  const stored = JSON.stringify(r);
  for (const forbidden of [key, "Authorization", "api_key", "arbitrary", "latitude", "reach", "https://"]) assert(!stored.includes(forbidden));
});
