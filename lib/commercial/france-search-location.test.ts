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

const saturated = (matches: ReturnType<typeof synthetic>[] = []) => [...matches,
  ...Array.from({ length: 100 - matches.length }, (_, i) => synthetic(`Unrelated ${i}`))];

test("99 results with one admissible city remain valid without clarification", async () => {
  let calls = 0;
  const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async () => {
    calls++; return Response.json(saturated([synthetic("Paris")]).slice(0, 99));
  } });
  assert.equal(r.ok, true); assert.equal(calls, 1); assert.equal(r.diagnostic.LOCATION_API_CALLS, 1);
});

for (const city of ["Paris", "Marseille", "Lyon", "Annecy", "Saint-Rémy-de-Provence"]) {
  test(`${city}: saturated initial response requires exactly one caller-derived clarification`, async () => {
    const queries: string[] = [], signals: AbortSignal[] = [];
    const match = synthetic(city, { google_id: 123456, reach: 1 }); // Synthetic ID only.
    const r = await resolveFranceSearchLocation({ city, apiKey: key, fetcher: async (input, init) => {
      const url = new URL(String(input)); queries.push(url.searchParams.get("q")!); signals.push(init!.signal!);
      assert.equal(url.searchParams.get("limit"), "100"); assert.equal(url.searchParams.has("api_key"), false);
      assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
      // An irrelevant first row/region must never construct the second query.
      return Response.json(queries.length === 1 ? saturated([synthetic("Other City"), match]) : [match]);
    } });
    assert.deepEqual(queries, [city, `${city}, France`]); assert.equal(signals[0], signals[1]);
    assert.equal(r.ok, true); if (r.ok) assert.equal(r.canonicalName, match.canonical_name);
    assert.equal(r.diagnostic.LOCATION_API_CALLS, 2); assert.equal(r.diagnostic.LOCATION_RESOLUTION, "RESOLVED");
  });
}

test("clarification geographic-ID deduplication is deterministic, never popularity", async () => {
  const a = synthetic("Paris", { google_id: 123456, reach: 1 });
  const b = synthetic("Paris", { google_id: "123456", reach: 999999 });
  for (const rows of [[a, b], [b, a]]) {
    let calls = 0;
    const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async () => {
      calls++; return Response.json(calls === 1 ? saturated([a]) : rows);
    } });
    assert.equal(r.ok, true); assert.equal(calls, 2);
    if (r.ok) assert.equal(r.canonicalName, a.canonical_name);
  }
  assert.deepEqual(selectFranceSearchLocation("Paris", [a, b]), { canonicalName: a.canonical_name });
  assert.deepEqual(selectFranceSearchLocation("Paris", [a, { ...b, canonical_name: "Paris,Other Region,France" }], true), { reason: "AMBIGUOUS_LOCATION" });
});

const clarificationFailures: [string, unknown, string][] = [
  ["second saturation", saturated([synthetic("Paris", { google_id: 123456 })]), "LOCATION_RESOLUTION_UNAVAILABLE"],
  ["French homonyms", [synthetic("Paris", { google_id: 123456 }), synthetic("Paris", { google_id: 123457, canonical_name: "Paris,Other Region,France" })], "AMBIGUOUS_LOCATION"],
  ["different IDs even with identical labels", [synthetic("Paris", { google_id: 123456 }), synthetic("Paris", { google_id: 123457 })], "AMBIGUOUS_LOCATION"],
  ["foreign homonym", [synthetic("Paris", { google_id: 123456, country_code: "US", canonical_name: "Paris,Texas,United States" })], "UNKNOWN_LOCATION"],
  ["fictitious/absent", [], "UNKNOWN_LOCATION"],
  ["provider error HTTP200", { error: "fixture" }, "LOCATION_RESOLUTION_UNAVAILABLE"],
  ["missing geographic ID", [synthetic("Paris")], "LOCATION_RESOLUTION_UNAVAILABLE"],
  ["unsafe numeric geographic ID", [synthetic("Paris", { google_id: Number.MAX_SAFE_INTEGER + 1 })], "LOCATION_RESOLUTION_UNAVAILABLE"],
  ["incomplete canonical", [synthetic("Paris", { google_id: 123456, canonical_name: "Paris,France" })], "LOCATION_RESOLUTION_UNAVAILABLE"],
];
for (const [name, payload, reason] of clarificationFailures) test(`clarification ${name}: fail closed, never third request`, async () => {
  let calls = 0;
  const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async () => {
    calls++; return Response.json(calls === 1 ? saturated([synthetic("Paris")]) : payload);
  } });
  assert.equal(r.ok, false); assert.equal(r.diagnostic.LOCATION_RESOLUTION, reason);
  assert.equal(calls, 2); assert.equal(r.diagnostic.LOCATION_API_CALLS, 2);
});

test("already visible French ambiguity cannot be erased by clarification", async () => {
  let calls = 0;
  const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async () => {
    calls++; return Response.json(saturated([synthetic("Paris", { google_id: 123456 }),
      synthetic("Paris", { google_id: 123457, canonical_name: "Paris,Other Region,France" })]));
  } });
  assert.equal(calls, 1); assert.equal(r.diagnostic.LOCATION_RESOLUTION, "AMBIGUOUS_LOCATION");
});

for (const status of [401, 429, 503]) test(`clarification HTTP${status}: two accounted calls, no retry`, async () => {
  let calls = 0;
  const r = await resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async () => {
    calls++; return calls === 1 ? Response.json(saturated()) : Response.json({ error: key }, { status });
  } });
  assert.equal(calls, 2); assert.equal(r.ok, false); assert.equal(r.diagnostic.LOCATION_HTTP_STATUS, status);
  assert.equal(r.diagnostic.LOCATION_RESOLUTION, "LOCATION_RESOLUTION_UNAVAILABLE"); assert(!JSON.stringify(r).includes(key));
});

test("clarification shares remaining8000ms deadline, no new timer/retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const pending = resolveFranceSearchLocation({ city: "Paris", apiKey: key, fetcher: async (_input, init) => {
    calls++;
    if (calls === 1) { t.mock.timers.tick(3000); return Response.json(saturated()); }
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("fixture", "AbortError"));
    }, { once: true }));
  } });
  // Drain the response-body microtasks until clarification has started.
  for (let i = 0; i < 20 && calls < 2; i++) await Promise.resolve();
  assert.equal(calls, 2); t.mock.timers.tick(4999); t.mock.timers.tick(1);
  const r = await pending;
  assert.equal(r.ok, false); assert.equal(calls, 2); assert.equal(r.diagnostic.LOCATION_TIMEOUT, true);
  assert.equal(r.diagnostic.LOCATION_HTTP_STATUS, null);
});
