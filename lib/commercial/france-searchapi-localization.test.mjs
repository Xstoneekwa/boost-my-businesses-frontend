import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as locations from "./france-search-location.ts";
import * as serp from "../instagram-client/target-ai-google-serp-discovery.ts";
import * as diagnostics from "./france-query-diagnostics.ts";
import * as queries from "./discovery-query-portfolio.ts";
import * as acquisition from "./france-acquisition.ts";
import * as execution from "./discovery-execution.ts";
import { COMMERCIAL_DISCOVERY_SUBSEGMENTS } from "./discovery-contract.ts";

const source = name => readFileSync(new URL(name, import.meta.url), "utf8");
const forbidden = async () => { throw Error("Unexpected live provider in offline integration test"); };
const oldFetch = globalThis.fetch, oldKey = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY, oldUrl = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL;
globalThis.fetch = forbidden;
process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY = "offline-fixture-only";
process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL = "https://www.searchapi.io/api/v1/search";
const captures = [];
after(() => {
  globalThis.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY; else process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY = oldKey;
  if (oldUrl === undefined) delete process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL; else process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL = oldUrl;
  if (process.env.BMB_LOCALIZATION_EVIDENCE_DIR) writeFileSync(`${process.env.BMB_LOCALIZATION_EVIDENCE_DIR}/mock-http-captures.json`, JSON.stringify({
    synthetic_fixtures_only: true, provider_calls: 0, captures,
  }, null, 2) + "\n", { mode: 0o600 });
});
function load(text, imports, env = {}) {
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  runInNewContext(output, { module: loaded, exports: loaded.exports, require(id) {
    if (!(id in imports)) throw Error(`Unmocked module ${id}`); return imports[id];
  }, process: { env }, fetch: forbidden, URL, Response, Headers, AbortController, Date, setTimeout, clearTimeout, crypto: globalThis.crypto });
  return loaded.exports;
}
const imports = { "@/lib/instagram-client/target-ai-google-serp-discovery": serp, "./discovery-query-portfolio": queries,
  "./france-query-diagnostics": diagnostics, "./france-profile-first": { runFranceProfileFirst: forbidden },
  "./france-acquisition": acquisition, "./france-search-location": locations };
const env = { INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY: "offline-fixture-only" };
const provider = load(source("discovery-provider.ts"), imports, env);
const baseSource = execFileSync("git", ["show", "8e60386957bdead4493526dbb493a45663c9dd19:lib/commercial/discovery-provider.ts"], { encoding: "utf8" });
const baseline = load(baseSource, imports, env);
const syntheticLocation = (city, extra = {}) => ({ name: city, country_code: "FR", target_type: "City",
  canonical_name: `${city},Synthetic Test Region,France`, ...extra });
function fixture(label, city, { locationPayload = [syntheticLocation(city)], locationStatus = 200, locationThrows, googlePayload = { organic_results: [] } } = {}) {
  const http = [], location = [];
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    const safe = new URL(url); if (safe.searchParams.has("api_key")) safe.searchParams.set("api_key", "[REDACTED]");
    captures.push({ test: label, url: safe.toString(), parameters: Object.fromEntries(safe.searchParams), method: init?.method, signal_present: Boolean(init?.signal), cache: init?.cache });
    if (url.pathname === "/api/v1/locations") {
      location.push({ url, init });
      if (locationThrows) throw locationThrows;
      return Response.json(typeof locationPayload === "function" ? locationPayload(url.searchParams.get("q"), location.length) : locationPayload, { status: locationStatus });
    }
    assert.equal(url.pathname, "/api/v1/search");
    http.push({ url, init });
    return Response.json(googlePayload);
  };
  return { http, location, fetcher };
}
for (const city of ["Paris", "Marseille", "Lyon", "Annecy", "Saint-Rémy-de-Provence"]) test(`broad FR ${city}: one Locations lookup,12 canonical queries, page1, real HTTP geo args`, async () => {
  const f = fixture(`broad-${city}`, city);
  const result = await provider.discoverCommercialCandidates({ countryCode: "FR", city, subsegment: null, maxCandidates: 10, fetcher: f.fetcher });
  assert.equal(f.location.length, 1); assert.equal(f.http.length, 12);
  assert.deepEqual(f.http.map(r => r.url.searchParams.get("q")), queries.buildCommercialDiscoveryQueries(city, null, "FR"));
  for (const r of f.http) {
    assert.equal(r.url.searchParams.get("location"), syntheticLocation(city).canonical_name);
    assert.equal(r.url.searchParams.get("gl"), "fr"); assert.equal(r.url.searchParams.get("hl"), "fr");
    assert.equal(r.url.searchParams.has("page"), false); assert.equal(r.url.searchParams.has("device"), false);
    assert.deepEqual([...r.url.searchParams.keys()].sort(), ["api_key", "engine", "q", "location", "gl", "hl"].sort());
    assert.equal(r.init.method, "GET"); assert.equal(r.init.cache, "no-store"); assert.ok(r.init.signal);
  }
  assert.equal(result.diagnostic.searchLocation.LOCATION_API_CALLS, 1);
  assert.equal(result.diagnostic.providerOutcomeCounters.attempts, 12); // Locations excluded.
  assert.equal(result.diagnostic.pagesFetched, 12); assert.equal(result.diagnostic.queryDiagnostics.length, 12);
  for (const d of result.diagnostic.queryDiagnostics) {
    assert.equal(d.COUNTRY, "FR"); assert.equal(d.REQUESTED_CITY, city); assert.equal(d.SEARCH_LOCATION, syntheticLocation(city).canonical_name);
    assert.equal(d.GL, "fr"); assert.equal(d.HL, "fr"); assert.equal(d.PAGE, 1);
  }
  assert.equal(COMMERCIAL_DISCOVERY_SUBSEGMENTS.length, 12);
});
test("targeted FR Marseille: unchanged q and historical two-page ceiling, one resolution reused", async () => {
  const f = fixture("targeted-Marseille", "Marseille");
  const result = await provider.discoverCommercialCandidates({ countryCode: "FR", city: "Marseille", subsegment: "Hair Salon", maxCandidates: 10, fetcher: f.fetcher });
  const expected = queries.buildCommercialDiscoveryQueries("Marseille", "Hair Salon", "FR");
  assert.equal(f.location.length, 1); assert.equal(f.http.length, expected.length * 2);
  for (let i = 0; i < expected.length; i++) {
    assert.deepEqual(f.http.slice(i * 2, i * 2 + 2).map(r => [r.url.searchParams.get("q"), r.url.searchParams.get("page") ?? "1"]), [[expected[i], "1"], [expected[i], "2"]]);
  }
  assert.ok(f.http.every(r => r.url.searchParams.get("location") === syntheticLocation("Marseille").canonical_name && r.url.searchParams.get("gl") === "fr" && r.url.searchParams.get("hl") === "fr"));
  assert.equal(result.diagnostic.providerOutcomeCounters.attempts, f.http.length);
});
const failures = [
  ["fictitious", "VilleInventéeDiagnostic", [], "UNKNOWN_LOCATION"],
  ["foreign homonym", "Paris", [syntheticLocation("Paris", { country_code: "US", canonical_name: "Paris,Texas,United States" })], "UNKNOWN_LOCATION"],
  ["missing canonical", "Paris", [syntheticLocation("Paris", { canonical_name: null })], "UNKNOWN_LOCATION"],
  ["ambiguous FR", "Saint-Martin", [syntheticLocation("Saint-Martin"), syntheticLocation("Saint-Martin", { canonical_name: "Saint-Martin,Other Synthetic Region,France" })], "AMBIGUOUS_LOCATION"],
  ["HTTP200 provider error", "Paris", { error: "fixture" }, "LOCATION_RESOLUTION_UNAVAILABLE"],
  ["HTTP503", "Paris", [], "LOCATION_RESOLUTION_UNAVAILABLE", 503],
  ["timeout", "Paris", [], "LOCATION_RESOLUTION_UNAVAILABLE", 200, new DOMException("fixture", "AbortError")],
];
for (const [name, city, locationPayload, reason, locationStatus = 200, locationThrows] of failures) test(`${name}: explicit refusal, zero Google transports, zero SERP attempts`, async () => {
  const f = fixture(name, city, { locationPayload, locationStatus, locationThrows });
  const r = await provider.discoverCommercialCandidates({ countryCode: "FR", city, maxCandidates: 10, fetcher: f.fetcher });
  assert.equal(f.location.length, 1); assert.equal(f.http.length, 0); assert.equal(r.candidates.length, 0);
  assert.equal(r.diagnostic.stoppedReason, reason); assert.equal(r.diagnostic.searchLocation.LOCATION_API_CALLS, 1);
  assert.equal(r.diagnostic.queriesExecuted, 0); assert.equal(r.diagnostic.providerOutcomeCounters.attempts, 0);
  assert.equal(r.diagnostic.queryDiagnostics.length, 0);
});
for (const city of ["Johannesburg", "Cape Town"]) for (const subsegment of [null, "Hair Salon"]) test(`ZA ${city}/${subsegment}: exact base transport and pagination`, async () => {
  const current = fixture(`ZA-${city}-${subsegment}`, city), before = fixture(`base-ZA-${city}-${subsegment}`, city);
  await provider.discoverCommercialCandidates({ countryCode: "ZA", city, subsegment, maxCandidates: 10, fetcher: current.fetcher });
  await baseline.discoverCommercialCandidates({ countryCode: "ZA", city, subsegment, maxCandidates: 10, fetcher: before.fetcher });
  assert.equal(current.location.length, 0); assert.equal(before.location.length, 0);
  assert.deepEqual(current.http.map(r => r.url.toString()), before.http.map(r => r.url.toString()));
  assert.ok(current.http.every(r => !r.url.searchParams.has("location") && !r.url.searchParams.has("gl") && !r.url.searchParams.has("hl")));
});
test("FR market, not city heuristic: Johannesburg with FR must not reach ZA Google transport", async () => {
  const f = fixture("FR-market-not-name", "Johannesburg", { locationPayload: [syntheticLocation("Johannesburg", { country_code: "ZA", canonical_name: "Johannesburg,Gauteng,South Africa" })] });
  const r = await provider.discoverCommercialCandidates({ countryCode: "FR", city: "Johannesburg", maxCandidates: 10, fetcher: f.fetcher });
  assert.equal(f.http.length, 0); assert.equal(r.diagnostic.stoppedReason, "UNKNOWN_LOCATION");
});
test("early-stop/candidate cap and Beauty filter remain active after localization", async () => {
  const f = fixture("early-stop", "Paris", { googlePayload: { organic_results: [
    { link: "https://www.instagram.com/offline_localized_fixture/", title: "Institut de beauté Paris" },
    { link: "https://www.instagram.com/offline_localized_fixture/", title: "Institut de beauté Paris" },
  ] } });
  const r = await provider.discoverCommercialCandidates({ countryCode: "FR", city: "Paris", maxCandidates: 1, fetcher: f.fetcher });
  assert.equal(f.location.length, 1); assert.equal(f.http.length, 1); assert.equal(r.candidates.length, 1);
});
test("Google HTTP200 error payload stays failed semantically; Locations not SERP success", async () => {
  const f = fixture("semantic-error", "Paris", { googlePayload: { error: { code: "offline_provider_error" } } });
  const r = await provider.discoverCommercialCandidates({ countryCode: "FR", city: "Paris", maxCandidates: 10, fetcher: f.fetcher });
  assert.equal(r.diagnostic.queriesSucceeded, 0); assert.equal(r.diagnostic.queriesFailed, 12);
  assert.equal(r.diagnostic.providerOutcomeCounters.provider_error_payload, 12); assert.equal(r.diagnostic.providerOutcomeCounters.attempts, 12);
  assert.equal(r.diagnostic.searchLocation.LOCATION_API_CALLS, 1);
});
test("existing national profile-first experiment remains separate, no per-candidate Locations injection", async () => {
  let calls = 0;
  const p = load(source("discovery-provider.ts"), { ...imports, "./france-profile-first": { runFranceProfileFirst: async () => {
    calls++; return { queries: [], candidates: [], diagnostic: { preserved: true } };
  } } }, env);
  const r = await p.discoverCommercialCandidates({ countryCode: "FR", city: "France", maxCandidates: 30,
    experiment: { runId: "offline-experiment", persist: forbidden }, fetcher: forbidden });
  assert.equal(calls, 1); assert.equal(r.diagnostic.preserved, true);
});
test("existing durable discovery reservation blocks replay before resolver/Google, no new SQL contract", async () => {
  const run = { id: "offline-run", city: "Paris", country_code: "FR", max_prospects: 10, status: "running", discovery_attempt_count: 1, discovery_max_attempts: 3 };
  const control = { state: "running" }; let discoveryCalls = 0, reservations = 0;
  const db = { from(table) {
    let patch;
    const target = table === "commercial_france_run_controls" ? control : run;
    const execute = () => { if (patch) Object.assign(target, patch); return { data: target, error: null }; };
    const q = { select: () => q, update: p => { patch = p; return q; }, eq: () => q, in: () => q,
      single: async () => execute(), maybeSingle: async () => execute(), then: (a, b) => Promise.resolve(execute()).then(a, b) };
    return q;
  }, async rpc(name, args) {
    if (name === "claim_commercial_discovery_runs_v2") return { data: [run], error: null };
    if (name === "reserve_commercial_france_provider_call_v1") {
      reservations++; assert.equal(args.p_call_kind, "discovery"); assert.equal(args.p_call_key, "run:offline-run:discovery");
      return { data: { reserved: false, reason: "idempotent_replay" }, error: null };
    }
    if (name === "refresh_commercial_discovery_run_v2") { run.status = "failed"; return { data: run, error: null }; }
    return { data: [], error: null };
  } };
  const p = load(source("discovery-processor.ts"), {
    "server-only": {}, "@/lib/supabase/admin": {}, "@/lib/instagram-public-profile-lookup": {}, "./discovery-ai": {},
    "./france-profile-first": {}, "./france-provider-outcome": {}, "./profile-first-anchor": {}, "./france-dinum-runtime": {},
    "./discovery-contract": {}, "./discovery-provider": {}, "./discovery-reliability": {}, "./discovery-scoring": {}, "./discovery-execution": execution,
  });
  await p.processCommercialDiscoveryBatch({ supabase: db, discover: async () => { discoveryCalls++; throw Error("must not resolve/replay"); } });
  assert.equal(reservations, 1); assert.equal(discoveryCalls, 0);
});

const saturatedLocations = match => [match, ...Array.from({ length: 99 }, (_, i) => syntheticLocation(`Other ${i}`))];
for (const subsegment of [null, "Hair Salon"]) test(`FR ${subsegment ?? "broad"}: two Locations counted once per run, shared across unchanged query portfolio`, async () => {
  const match = syntheticLocation("Paris", { google_id: 123456 }); // Synthetic ID only.
  const f = fixture(`clarification-${subsegment}`, "Paris", { locationPayload: (q, count) => {
    assert.equal(q, count === 1 ? "Paris" : "Paris, France");
    return count === 1 ? saturatedLocations(match) : [match, { ...match, google_id: "123456" }];
  } });
  const r = await provider.discoverCommercialCandidates({ countryCode: "FR", city: "Paris", subsegment, maxCandidates: 10, fetcher: f.fetcher });
  const expected = queries.buildCommercialDiscoveryQueries("Paris", subsegment, "FR");
  const pages = subsegment ? 2 : 1;
  assert.equal(f.location.length, 2); assert.equal(f.http.length, expected.length * pages);
  assert.deepEqual(f.http.map(x => x.url.searchParams.get("q")), expected.flatMap(q => Array(pages).fill(q)));
  assert.ok(f.http.every(x => x.url.searchParams.get("location") === match.canonical_name && x.url.searchParams.get("gl") === "fr" && x.url.searchParams.get("hl") === "fr"));
  assert.equal(r.diagnostic.searchLocation.LOCATION_API_CALLS, 2);
  assert.equal(r.diagnostic.providerOutcomeCounters.attempts, f.http.length); // Not +2 Locations.
  assert.equal(r.diagnostic.pagesFetched, f.http.length);
});
for (const [name, clarification, reason] of [
  ["saturated", saturatedLocations(syntheticLocation("Paris", { google_id: 123456 })), "LOCATION_RESOLUTION_UNAVAILABLE"],
  ["homonyms", [syntheticLocation("Paris", { google_id: 123456 }), syntheticLocation("Paris", { google_id: 123457, canonical_name: "Paris,Other Region,France" })], "AMBIGUOUS_LOCATION"],
  ["foreign", [syntheticLocation("Paris", { google_id: 123456, country_code: "US", canonical_name: "Paris,Texas,United States" })], "UNKNOWN_LOCATION"],
  ["provider error", { error: "fixture" }, "LOCATION_RESOLUTION_UNAVAILABLE"],
]) test(`unresolved ${name} clarification: zero Google and zero SERP usage`, async () => {
  const f = fixture(`refused-clarification-${name}`, "Paris", { locationPayload: (_q, count) => count === 1 ? saturatedLocations(syntheticLocation("Paris")) : clarification });
  const r = await provider.discoverCommercialCandidates({ countryCode: "FR", city: "Paris", subsegment: null, maxCandidates: 10, fetcher: f.fetcher });
  assert.equal(f.location.length, 2); assert.equal(f.http.length, 0);
  assert.equal(r.diagnostic.searchLocation.LOCATION_API_CALLS, 2); assert.equal(r.diagnostic.stoppedReason, reason);
  assert.equal(r.diagnostic.providerOutcomeCounters.attempts, 0); assert.equal(r.diagnostic.pagesFetched, 0); assert.equal(r.candidates.length, 0);
});
