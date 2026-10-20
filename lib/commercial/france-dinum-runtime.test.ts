import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveFranceDinumAnchor, selectDinumRunCandidates, usableDinumName, type DinumRuntimeInput } from "./france-dinum-runtime";
import { COMMERCIAL_DISCOVERY_SUBSEGMENTS } from "./discovery-contract";
import { DinumAnchorClient, type DinumInstagramAnchorInput } from "./dinum-anchor-client";

const runId = "00000000-0000-4000-8000-000000000100";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, extra = "") => ({ id: id(n), selected_for_processing: true, run_id: runId,
  source_snapshot_safe: { instagram_handle: `atelier${n}`, profile_url: `https://instagram.com/atelier${n}/`, title: `Atelier Rubis${n}`, snippet: `Institut de beauté Paris ${extra}` } });
const input = (n = 1): DinumRuntimeInput => ({ runId, itemId: id(n), country: "FR", city: "Paris", instagramHandle: `atelier${n}`,
  profileUrl: `https://instagram.com/atelier${n}/`, observedName: `Atelier Rubis${n}`, publicProfile: true,
  precheckDecision: "PRECHECK_PASS", precheckReason: "plausible_local_beauty_business", plausibleFranceLocation: true, anchorAdmitted: false });
const empty = () => Response.json({ page: 1, per_page: 5, total_results: 0, total_pages: 0, results: [] });
const payload = (n = 1) => ({ page: 1, per_page: 5, total_results: 1, total_pages: 1, results: [{ siren: "001234567", nom_raison_sociale: "SOCIETE FIXTURE", etat_administratif: "A", statut_diffusion: "O", nombre_etablissements: 1,
  matching_etablissements: [{ siret: "00123456700001", nom_commercial: `Atelier Rubis${n}`, adresse: "12 RUE EXEMPLE 75018 PARIS", code_postal: "75018", commune: "75118", libelle_commune: "PARIS 18", activite_principale: "96.02A", statut_diffusion_etablissement: "O", etat_administratif: "A" }] }] });
type RecordRow = Record<string, unknown>;
function harness({ prior = [] as RecordRow[], state = "running", limit = 2, denied = "", fetcher = empty as typeof fetch, items = [item(1), item(2), item(3)] } = {}) {
  const calls = [...prior], events: Array<{ name: string; args?: RecordRow }> = [];
  const db = {
    from(name: string) {
      const filters: Array<(r: RecordRow) => boolean> = []; let cap = 99;
      const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
        neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; }, limit: (v: number) => { cap = v; return q; },
        maybeSingle: async () => ({ data: { state, budget_limits_safe: { sirene: limit } }, error: null }),
        then: (yes: (r: unknown) => unknown) => { const rows = name === "commercial_discovery_items" ? items : calls;
          return Promise.resolve({ data: rows.filter(r => filters.every(f => f(r))).slice(0, cap), error: null }).then(yes); },
      }; return q;
    },
    async rpc(name: string, args: RecordRow) {
      events.push({ name, args });
      if (name === "reserve_commercial_france_provider_call_v1") {
        if (denied) return { data: { reserved: false, reason: denied }, error: null };
        if (calls.some(c => c.call_key === args.p_call_key)) return { data: { reserved: false, reason: "idempotent_replay" }, error: null };
        if (calls.length >= limit) return { data: { reserved: false, reason: "budget_exceeded" }, error: null };
        assert.equal(args.p_provider, "dinum"); assert.equal(args.p_call_kind, "sirene");
        const call = { id: id(90 + calls.length), run_id: runId, provider: "dinum", call_kind: "sirene", call_key: args.p_call_key, status: "reserved" };
        calls.push(call); return { data: { reserved: true, call_id: call.id }, error: null };
      }
      assert.equal(name, "finish_commercial_france_provider_call_v1");
      Object.assign(calls.find(c => c.id === args.p_call_id)!, { status: args.p_status, error_code: args.p_error_code });
      return { data: {}, error: null };
    },
  };
  const transport: typeof fetch = async (...args) => {
    events.push({ name: "HTTP" }); assert.equal(calls.at(-1)?.status, "reserved");
    return fetcher(...args);
  };
  const invoke = (change: Partial<DinumRuntimeInput> = {}, n = 1) => resolveFranceDinumAnchor(db as unknown as Parameters<typeof resolveFranceDinumAnchor>[0], { ...input(n), ...change }, transport);
  return { invoke, calls, events };
}
test("allocation ranks whole immutable run: later exact legal/local/site hints beat first arrivals", () => {
  const rows = [item(1), item(2, "https://rubis.example/"), item(3, "75018"), item(4, "SIRET: 00123456700001")];
  assert.deepEqual(selectDinumRunCandidates(rows, "Paris").map(c => c.itemId), [id(4), id(3)]);
  assert.deepEqual(selectDinumRunCandidates([...rows].reverse(), "Paris"), selectDinumRunCandidates(rows, "Paris"));
});
test("allocation never uses query/position/followers/popularity and stable ties do not depend on claim order", () => {
  const rows = [item(3), item(2), item(1)];
  assert.deepEqual(selectDinumRunCandidates(rows, "Paris").map(c => c.itemId), [id(1), id(2)]);
  Object.assign(rows[0], { followers: 10000000, source_query: "Paris SIRET", candidate_rank: 1 });
  assert.deepEqual(selectDinumRunCandidates(rows, "Paris").map(c => c.itemId), [id(1), id(2)]);
  assert.equal(selectDinumRunCandidates([{ ...item(1), source_snapshot_safe: { ...item(1).source_snapshot_safe, snippet: "", source_query: "Paris" } }], "Paris").length, 0);
});
for (const change of [{ country: "ZA" }, { publicProfile: false }, { profileUrl: "https://instagram.com/privacy/" }, { precheckDecision: "PRECHECK_REJECT" },
  { precheckDecision: "PRECHECK_AMBIGUOUS", precheckReason: "beauty_vertical_unproven" }, { plausibleFranceLocation: false }, { observedName: "Electrician Paris" }, { observedName: "Beauty Salon Paris" }, { anchorAdmitted: true }]) {
  test(`no provider for ineligible trigger ${JSON.stringify(change)}`, async () => {
    const h = harness(); const result = await h.invoke(change); assert.equal(h.events.length, 0); assert.equal(result.anchor, null);
  });
}
test("all twelve ZA canonical subsegments may enter the lookup path; no NAF POC prefilter", async () => {
  for (const segment of COMMERCIAL_DISCOVERY_SUBSEGMENTS) {
    const h = harness(); await h.invoke({ observedName: `Rubis ${segment}` }); assert.equal(h.events.filter(e => e.name === "HTTP").length, 1);
  }
});
test("nonallocated candidate is HOLD, never LOW or implicit retry", async () => {
  const h = harness(); const result = await h.invoke({}, 3); assert.equal(result.evidence.reason, "OFFICIAL_LOOKUP_BUDGET_NOT_ALLOCATED");
  assert.equal(result.evidence.disposition, "HOLD"); assert.equal(h.events.length, 0);
});
for (const denial of ["idempotent_replay", "budget_exceeded", "run_not_running", "control_not_running"]) test(`RPC ${denial}: no transport, no finish`, async () => {
  const h = harness({ denied: denial }); const r = await h.invoke(); assert.equal(r.evidence.reason, `DINUM_${denial}`.toUpperCase());
  assert.equal(h.events.length, 1); assert.equal(h.events[0].name, "reserve_commercial_france_provider_call_v1");
});
for (const state of ["hold", "stopped", "cancelled", "completed"]) test(`control ${state} blocks HTTP/reservation`, async () => {
  const h = harness({ state }); assert.equal((await h.invoke()).evidence.reason, "DINUM_CONTROL_NOT_RUNNING"); assert.equal(h.events.length, 0);
});
for (const providers of [["dinum", "dinum"], ["sirene", "dinum"], ["sirene", "sirene"]]) test(`shared budget already consumed by ${providers}: no third transport`, async () => {
  const prior = providers.map((provider, n) => ({ id: id(80 + n), run_id: runId, provider, call_kind: "sirene", status: "succeeded" }));
  const h = harness({ prior }); assert.equal((await h.invoke()).evidence.reason, "OFFICIAL_LOOKUP_BUDGET_EXHAUSTED"); assert.equal(h.calls.length, 2); assert.equal(h.events.length, 0);
});
test("two concurrent allocated candidates consume exactly two shared units, third remains HOLD", async () => {
  const h = harness(); await Promise.all([h.invoke(), h.invoke({}, 2), h.invoke({}, 3)]);
  assert.equal(h.calls.length, 2); assert.equal(h.events.filter(e => e.name === "HTTP").length, 2);
  assert.ok(h.calls.every(c => c.status === "succeeded"));
});
test("replay across new client instances has same deterministic key and no second transport", async () => {
  const h = harness(); await h.invoke(); const r = await h.invoke(); assert.equal(r.evidence.reason, "DINUM_IDEMPOTENT_REPLAY");
  assert.equal(h.events.filter(e => e.name === "HTTP").length, 1); assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].call_key, `run:${runId}:item:${id(1)}:dinum:initial`);
});
test("UNIQUE_MATCH is an anchor candidate, canonical identity still Sirene/exact SIRET, no raw payload", async () => {
  const h = harness({ fetcher: async () => Response.json(payload()) }); const result = await h.invoke();
  assert.equal(result.anchor?.candidate.provider, "sirene"); assert.equal(result.anchor?.candidate.externalId, "00123456700001");
  assert.equal(result.evidence.delivery_source, "dinum"); assert.equal(result.evidence.disposition, "ANCHOR_CANDIDATE");
  assert.doesNotMatch(JSON.stringify(result), /observations|reservation|query|Authorization|api.key/);
});
for (const mode of ["NO_MATCH", "AMBIGUOUS", "UNKNOWN_ACTIVITY"]) test(`${mode}: HOLD without identity LOW or invented anchor`, async () => {
  const h = harness({ fetcher: async () => {
    if (mode === "NO_MATCH") return empty();
    const p = payload(); if (mode === "AMBIGUOUS") { p.total_pages = 2; p.total_results = 9; }
    else p.results[0].matching_etablissements[0].activite_principale = "86.90F";
    return Response.json(p);
  } });
  const result = await h.invoke(); assert.equal(result.anchor, null); assert.equal(result.evidence.disposition, "HOLD");
  assert.equal(h.calls[0].status, "succeeded");
});
for (const mode of ["429", "503", "timeout", "schema", "html"]) test(`explicit ${mode} failure, bounded ledger, no follow-up DINUM or raw error body`, async () => {
  const h = harness({ fetcher: async () => {
    if (mode === "timeout") throw new DOMException("credential should never persist", "TimeoutError");
    if (mode === "schema") return Response.json({ private: "do not persist" });
    return new Response("secret unrelated provider body", { status: mode === "429" ? 429 : mode === "503" ? 503 : 200,
      headers: { "retry-after": "60", "content-type": "text/html" } });
  } });
  const result = await h.invoke(); assert.equal(result.anchor, null); assert.equal(h.calls[0].status, "failed");
  assert.ok(result.evidence.reason.startsWith("dinum_")); assert.doesNotMatch(JSON.stringify(result), /credential|secret|private/);
  if (mode === "429") assert.equal(result.evidence.retry_after, "60");
  assert.equal((await h.invoke({}, 2)).evidence.reason, "DINUM_PRIOR_PROVIDER_FAILURE_NO_RETRY");
  assert.equal(h.events.filter(e => e.name === "HTTP").length, 1);
});
test("budget drift >2 or in-flight official lookup fails closed", async () => {
  const drift = harness({ limit: 3 }); assert.equal((await drift.invoke()).evidence.reason, "OFFICIAL_LOOKUP_BUDGET_CONTRACT_MISMATCH"); assert.equal(drift.events.length, 0);
  const pending = harness({ prior: [{ run_id: runId, call_kind: "sirene", provider: "sirene", status: "reserved" }] });
  assert.equal((await pending.invoke()).evidence.reason, "OFFICIAL_LOOKUP_IN_FLIGHT_NO_RETRY"); assert.equal(pending.events.length, 0);
});
test("legacy four-profile whitelist is not implicitly expanded; runtime scope is explicit and item-bound", async () => {
  let calls = 0;
  const i: DinumInstagramAnchorInput = { instagramHandle: "atelier1", sourceItemId: id(1), profileUrl: input().profileUrl,
    nameHint: { value: "Atelier Rubis", sourceReference: "observed", fieldPath: "profile.name" }, targetCity: "Paris" };
  const client = new DinumAnchorClient({ reserve: async () => true, finish: async () => {} }, async () => { calls++; return empty(); });
  await assert.rejects(client.search(i), /instagram_first/); assert.equal(calls, 0);
  const scoped = new DinumAnchorClient({ reserve: async () => true, finish: async () => {} }, async () => { calls++; return empty(); }, [], { runId, candidates: [{ sourceItemId: id(2), instagramHandle: "atelier1" }] });
  await assert.rejects(scoped.search(i), /instagram_first/); assert.equal(calls, 0);
});
test("name must have an observed distinctive component; no requested-city/handle fabrication", () => {
  for (const name of ["", "Salon Paris", "Hair Stylist", "Institut de beauté", "Wellness Studio"]) assert.equal(usableDinumName(name, "Paris"), false, name);
  assert.equal(usableDinumName("Atelier Rubis", "Paris"), true);
  const source = readFileSync(new URL("./france-dinum-runtime.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /analyzeCommercial|scoreCommercial|sendEmail|FR_BEAUTY_ACTIVITY_FILTER/);
});
