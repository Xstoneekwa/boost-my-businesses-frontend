import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";
import { FranceProviderOperationError, lookupFranceProfile, runFranceItemOperation, franceProviderDiagnostic } from "./france-provider-outcome.ts";
import { lookupInstagramPublicProfile, resetInstagramPublicProfileLookupGuardsForTests } from "../instagram-public-profile-lookup.ts";
import { franceDiagnosticFetcher, franceSemanticSerpCounters, type FranceQueryDiagnostic } from "./france-query-diagnostics.ts";

type Row = Record<string, unknown>;
const historical = JSON.parse(readFileSync(new URL("./fixtures/paris-v8-provider-outcome-v1.json", import.meta.url), "utf8"));
const forbidden = async () => { throw Error("Unexpected live transport in provider outcome tests"); };
const originalFetch = globalThis.fetch;
globalThis.fetch = forbidden;
after(() => { globalThis.fetch = originalFetch; });

function fixture({ prior, snapshot = {}, state = "running", limit = 10, checkpointFails = false, finishFails = false }:
  { prior?: Row; snapshot?: Row; state?: string; limit?: number; checkpointFails?: boolean; finishFails?: boolean } = {}) {
  const item: Row = { id: "fixture-item", run_id: "fixture-run", status: "processing", attempt_count: 1, enrichment_snapshot_safe: snapshot };
  const calls: Row[] = prior ? [{ id: "call-1", call_key: "item:fixture-item:profile", status: "succeeded", ...prior }] : [];
  const events: string[] = [];
  const raw = { from(table: string) {
    let patch: Row | undefined; const filters: Array<(v: Row) => boolean> = [];
    const q = { select: () => q, update: (v: Row) => { patch = v; return q; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      single: async () => {
        const found = (table === "commercial_discovery_items" ? [item] : calls).find(v => filters.every(f => f(v)));
        if (!found || patch && checkpointFails) return { data: null, error: { code: "fixture_write_failure" } };
        if (patch) { events.push("checkpoint"); Object.assign(found, structuredClone(patch)); }
        return { data: structuredClone(found), error: null };
      } };
    return q;
  }, async rpc(name: string, args: Row) {
    if (name === "reserve_commercial_france_provider_call_v1") {
      events.push("reserve");
      if (state !== "running") return { data: { reserved: false, reason: "run_not_running" }, error: null };
      const existing = calls.find(c => c.call_key === args.p_call_key);
      if (existing) return { data: { reserved: false, reason: "idempotent_replay", call_id: existing.id }, error: null };
      if (calls.length >= limit) return { data: { reserved: false, reason: "budget_exceeded", used: calls.length, limit }, error: null };
      const call = { id: `call-${calls.length + 1}`, call_key: args.p_call_key, status: "reserved" };
      calls.push(call); return { data: { reserved: true, call_id: call.id }, error: null };
    }
    assert.equal(name, "finish_commercial_france_provider_call_v1");
    events.push("finish");
    if (finishFails) { finishFails = false; return { data: null, error: { code: "fixture_finish_failure" } }; }
    const call = calls.find(c => c.id === args.p_call_id);
    assert.equal(call?.status, "reserved");
    Object.assign(call!, { status: args.p_status, error_code: args.p_error_code, result_count: args.p_result_count });
    return { data: { ok: true }, error: null };
  } };
  return { item, calls, events, db: raw as unknown as Parameters<typeof lookupFranceProfile>[0] };
}
function realLookup() {
  resetInstagramPublicProfileLookupGuardsForTests();
  return (handle: string, options: Parameters<typeof lookupInstagramPublicProfile>[1]) => lookupInstagramPublicProfile(handle, {
    ...options, provider: "searchapi", disableCache: true, minIntervalMs: 0, maxPerMinute: 0,
  });
}
const oldEndpoint = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL, oldKey = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY;
process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL = "https://provider.invalid/fixture";
process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY = "offline-fixture-only";
after(() => {
  if (oldEndpoint === undefined) delete process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL; else process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL = oldEndpoint;
  if (oldKey === undefined) delete process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY; else process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY = oldKey;
});
const profile = { profile: { username: "fixture", full_name: "Salon Fixture", biography: "Institut de beauté Paris", is_private: false } };
const results: Array<[string, () => Promise<Response>, string, string | null, number | null]> = [
  ["valid profile", async () => Response.json(profile, { headers: { "x-request-id": "req_fixture" } }), "succeeded", null, 200],
  ["HTTP 200 provider error", async () => Response.json({ error: { code: "fixture_provider_failure", type: "fixture_error" } }), "failed", "profile_provider_error", 200],
  ["provider error plus misleading profile", async () => Response.json({ ...profile, error: { code: "fixture_provider_failure" } }), "failed", "profile_provider_error", 200],
  ["HTTP 401", async () => Response.json({ error: { code: "access_denied", type: "authentication_error" } }, { status: 401 }), "failed", "profile_provider_error", 401],
  ["timeout", async () => { throw new DOMException("fixture timeout", "AbortError"); }, "failed", "profile_timeout", null],
  ["malformed JSON", async () => new Response("not-json"), "failed", "profile_invalid_payload", 200],
  ["unusable object", async () => Response.json({ data: {} }), "failed", "profile_invalid_payload", 200],
  ["not found", async () => Response.json({}, { status: 404 }), "failed", "profile_not_found", 404],
];
for (const [name, fetcher, ledgerStatus, code, http] of results) test(`${name}: real normalizer, truthful ledger, durable replay without second transport`, async () => {
  const f = fixture(); let transports = 0;
  const transport: typeof fetch = async () => { transports++; f.events.push("HTTP"); assert.equal(f.calls[0].status, "reserved"); return fetcher(); };
  const outcome = await lookupFranceProfile(f.db, f.item, "fixture", realLookup(), transport);
  assert.equal(outcome.ledger_status, ledgerStatus); assert.equal(outcome.error_code, code);
  assert.equal(f.calls[0].status, ledgerStatus); assert.equal(outcome.diagnostic.http_status, http);
  assert.ok(f.events.indexOf("reserve") < f.events.indexOf("HTTP"));
  assert.ok(f.events.indexOf("checkpoint") < f.events.indexOf("finish"));
  const replay = await lookupFranceProfile(f.db, { ...f.item, attempt_count: 2 }, "fixture", realLookup(), forbidden);
  assert.deepEqual(replay, outcome); assert.equal(transports, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.events.filter(e => e === "finish").length, 1);
});
test("safe error diagnostic retains code/type/reference, never message/key/Authorization/raw payload", async () => {
  const f = fixture(); const sensitive = ["never", "export", "credential"].join("-");
  const outcome = await lookupFranceProfile(f.db, f.item, "fixture", realLookup(), async () => Response.json({
    error: { code: "fixture_failure", type: "fixture_error", message: sensitive }, Authorization: sensitive, api_key: sensitive,
  }, { headers: { "x-request-id": "req_safe" } }));
  assert.equal(outcome.diagnostic.provider_error_code, "fixture_failure");
  assert.equal(outcome.diagnostic.provider_error_type, "fixture_error"); assert.equal(outcome.diagnostic.request_id, "req_safe");
  assert.ok(outcome.diagnostic.observed_at); assert.equal(JSON.stringify(f.item).includes(sensitive), false);
  assert.equal(JSON.stringify(f.item).includes("offline-fixture-only"), false);
});
test("credential-looking values in diagnostic-code positions are dropped", async () => {
  const f = fixture();
  const o = await lookupFranceProfile(f.db, f.item, "fixture", realLookup(), async () => Response.json({ error: { code: ["sk", "fixture"].join("-"), type: "Bearer_credential" } }, { headers: { "x-request-id": "api_key_secret" } }));
  assert.equal(o.diagnostic.provider_error_code, null); assert.equal(o.diagnostic.provider_error_type, null); assert.equal(o.diagnostic.request_id, null);
});
for (const state of ["stopped", "hold"]) test(`${state}: no transport and no new reservation`, async () => {
  const f = fixture({ state });
  await assert.rejects(lookupFranceProfile(f.db, f.item, "fixture", realLookup(), forbidden), /run_not_running/);
  assert.equal(f.calls.length, 0);
});
test("exhausted budget refuses before transport", async () => {
  const f = fixture({ limit: 0 });
  await assert.rejects(lookupFranceProfile(f.db, f.item, "fixture", realLookup(), forbidden), /budget_exceeded/);
  assert.equal(f.calls.length, 0);
});
test("in-flight without checkpoint defers, never launches a duplicate transport", async () => {
  const f = fixture({ prior: { status: "reserved" } });
  await assert.rejects(lookupFranceProfile(f.db, f.item, "fixture", realLookup(), forbidden), (e: unknown) => e instanceof FranceProviderOperationError && e.pending && e.message === "provider_operation_in_flight");
  assert.equal(f.calls.length, 1); assert.equal(f.events.includes("finish"), false);
});
test("failed durable checkpoint cannot be falsely finished succeeded", async () => {
  const f = fixture({ checkpointFails: true });
  await assert.rejects(lookupFranceProfile(f.db, f.item, "fixture", realLookup(), async () => Response.json(profile)), /checkpoint_failed/);
  assert.equal(f.calls[0].status, "reserved"); assert.equal(f.events.includes("finish"), false);
});
test("crash after capture before finish reconciles only ledger, never transports again", async () => {
  const f = fixture({ finishFails: true }); let transports = 0;
  await assert.rejects(lookupFranceProfile(f.db, f.item, "fixture", realLookup(), async () => { transports++; return Response.json(profile); }), /ledger_write_failed/);
  const replay = await lookupFranceProfile(f.db, f.item, "fixture", realLookup(), forbidden);
  assert.equal(replay.ledger_status, "succeeded"); assert.equal(f.calls[0].status, "succeeded"); assert.equal(transports, 1);
});
test("legacy usable normalized profile is reused without a second transport", async () => {
  const normalized = await lookupInstagramPublicProfile("fixture", { provider: "mock" });
  const f = fixture({ prior: {}, snapshot: { instagram: { ...normalized, ok: true, status: "found", canonical_username: "fixture" } } });
  const result = await lookupFranceProfile(f.db, f.item, "fixture", realLookup(), forbidden);
  assert.equal(result.ledger_status, "succeeded"); assert.equal(f.calls.length, 1); assert.equal(f.events.includes("finish"), false);
});
for (const handle of historical.actual_facts.handles) test(`V8 ${handle}: missing historical outcome stays UNKNOWN, no fabricated replay error/second HTTP`, async () => {
  const f = fixture({ prior: { status: "succeeded", result_count: 0 } });
  await assert.rejects(lookupFranceProfile(f.db, f.item, handle, realLookup(), forbidden), (e: unknown) =>
    e instanceof FranceProviderOperationError && e.message === "provider_outcome_unavailable" && e.safeDetail.original_outcome === "NOT_RECORDED");
  assert.equal(f.calls.length, 1); assert.equal(f.events.includes("finish"), false);
});
for (const handle of historical.actual_facts.handles) test(`V8 ${handle}: explicitly SYNTHETIC future failure retains original diagnosis on resume`, async () => {
  const f = fixture(); const synthetic = historical.synthetic_future_failure;
  const first = await lookupFranceProfile(f.db, f.item, handle, realLookup(), async () => Response.json({ error: { code: synthetic.code, type: synthetic.type } }, { status: synthetic.status }));
  const replay = await lookupFranceProfile(f.db, f.item, handle, realLookup(), forbidden);
  assert.deepEqual(replay, first); assert.equal(replay.diagnostic.provider_error_code, synthetic.code);
  assert.equal(replay.error_code, "profile_provider_error"); assert.equal(f.calls.length, 1);
});
test("subsequent site operation also reuses captured result without extra budget", async () => {
  const f = fixture(); let transports = 0;
  const operate = async () => { transports++; return { ledger_status: "succeeded" as const, result_count: 1, error_code: null, diagnostic: franceProviderDiagnostic(), value: { pagesFetched: 1, websiteUrl: "https://fixture.invalid/" } }; };
  const first = await runFranceItemOperation(f.db, f.item, "site_page", operate);
  const second = await runFranceItemOperation(f.db, f.item, "site_page", async () => { throw Error("second site HTTP forbidden"); });
  assert.deepEqual(first, second); assert.equal(transports, 1); assert.equal(f.calls.length, 1);
});
test("V8 SERP fixture: 11 HTTP2xx != 8 usable; three error payloads plus one timeout", async () => {
  const records: FranceQueryDiagnostic[] = [];
  for (let i = 0; i < 12; i++) {
    const observed = franceDiagnosticFetcher(async () => {
      if (i === 11) throw new DOMException("fixture timeout", "AbortError");
      return Response.json(i < 8 ? { organic_results: [{ link: "https://instagram.com/fixture/" }] } : { error: { code: "fixture_error", type: "provider_error" } });
    }, records);
    try { await observed("https://provider.invalid/?q=fixture"); } catch { /* recorded */ }
  }
  assert.deepEqual(franceSemanticSerpCounters(records), { attempts: 12, transport_http_2xx: 11, serp_ok: 8, provider_error_payload: 3, timeout: 1, empty: 0, provider_errors: 3 });
  assert.equal(records[8].provider_error_code, "fixture_error");
});
test("SERP empty and malformed payload stay distinct from usable OK", async () => {
  const records: FranceQueryDiagnostic[] = [];
  await franceDiagnosticFetcher(async () => Response.json({ organic_results: [] }), records)("https://provider.invalid/?q=fixture");
  await franceDiagnosticFetcher(async () => new Response("bad-json"), records)("https://provider.invalid/?q=fixture");
  assert.deepEqual(franceSemanticSerpCounters(records), { attempts: 2, transport_http_2xx: 2, serp_ok: 0, provider_error_payload: 0, timeout: 0, empty: 1, provider_errors: 1 });
});

test("strict FR provider failure remains failure on a cross-item cache hit; default ZA remains unchanged", async () => {
  resetInstagramPublicProfileLookupGuardsForTests();
  let transports = 0;
  const mock: typeof fetch = async () => { transports++; return Response.json({ ...profile, error: { code: "fixture_error" } }); };
  const opts = { provider: "searchapi", strictProviderOutcome: true, minIntervalMs: 0, maxPerMinute: 0, fetcher: mock };
  const first = await lookupInstagramPublicProfile("fixture", opts);
  const cached = await lookupInstagramPublicProfile("fixture", opts);
  assert.equal(first.status, "provider_error"); assert.equal(cached.status, "provider_error"); assert.equal(transports, 1);
  const legacy = await lookupInstagramPublicProfile("fixture", { ...opts, strictProviderOutcome: false });
  assert.equal(legacy.status, "found"); assert.equal(transports, 2, "strict FR cache must not overwrite the default/ZA cache contract");
});

test("SERP non-2xx preserves safe code/type/reference without exporting body", async () => {
  const records: FranceQueryDiagnostic[] = [];
  await franceDiagnosticFetcher(async () => Response.json({ error: { code: "fixture_denied", type: "fixture_auth_error" }, search_metadata: { id: "search_fixture" } }, { status: 403 }), records)("https://provider.invalid/?q=fixture");
  assert.equal(records[0].status, 403); assert.equal(records[0].provider_error_code, "fixture_denied");
  assert.equal(records[0].provider_error_type, "fixture_auth_error"); assert.equal(records[0].request_id, "search_fixture");
  assert.equal(franceSemanticSerpCounters(records).serp_ok, 0);
});

test("a claimed found result without a normalized username is unusable, never succeeded", async () => {
  const f = fixture();
  const normalized = await lookupInstagramPublicProfile("fixture", { provider: "mock" });
  const outcome = await lookupFranceProfile(f.db, f.item, "fixture", async () => ({ ...normalized, ok: true, status: "found", canonical_username: null }), forbidden);
  assert.equal(outcome.ledger_status, "failed"); assert.equal(outcome.error_code, "profile_invalid_payload");
});
