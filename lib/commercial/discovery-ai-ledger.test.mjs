import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { analyzeCommercialProspect } from "./discovery-ai.ts";

const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const forbidden = () => { throw new Error("Unexpected provider/dependency in offline scoring test"); };
function load(name, imports) {
  const output = ts.transpileModule(source(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  runInNewContext(output, { module: loaded, exports: loaded.exports, require(id) {
    if (!(id in imports)) throw new Error(`Unmocked import ${id}`); return imports[id];
  }, process: { env: {} }, crypto: { randomUUID }, Date, setTimeout });
  return loaded.exports;
}
const market = load("market-config.ts", {});
const contract = load("discovery-contract.ts", { "./market-config.ts": market });
const execution = load("discovery-execution.ts", {});
const valid = { businessName: "Safe Fixture", subsegment: "Hair Salon", locationConfidence: .9, verticalConfidence: .9, confidence: .9,
  dimensions: { instagramImportance: 7, contentQuality: 7, activity: 7, commercialStrength: 7, customerValue: 7, targetingFit: 7, growthPotential: 7, decisionMakerAccess: 7, budgetFit: 7 },
  evidence: ["Public salon description"], reasoning: "Observed fixture evidence.", recommendedChannel: "instagram", recommendedAngle: "A",
  signals: { isLocal: true, isBeautyAesthetics: true, isCommerciallyActive: true, appearsClosed: false } };

async function workerFixture(aiResult, { country = "FR", rejectAfterScoring = false } = {}) {
  const run = { id: "fixture-run", country_code: country, status: "running" };
  const control = { run_id: run.id, state: "running" };
  const item = { id: "fixture-item", run_id: run.id, city: country === "FR" ? "Paris" : "Cape Town", provider_external_id: "fixture", source_snapshot_safe: { instagram_handle: "fixture" }, status: "pending", attempt_count: 0, max_attempts: 3 };
  const tables = { commercial_discovery_runs: [run], commercial_france_run_controls: country === "FR" ? [control] : [], commercial_discovery_items: [item], commercial_discovery_audit_events: [] };
  const calls = []; const ledger = new Map(); let ingested; let analyses = 0;
  function from(name) {
    assert.ok(name in tables, `Unexpected table ${name}`);
    const filters = []; let patch; let inserted;
    const execute = (single = false) => {
      const rows = tables[name].filter((row) => filters.every((f) => f(row)));
      if (patch) rows.forEach((row) => Object.assign(row, patch)); if (inserted) tables[name].push(inserted);
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const query = { select() { return query; }, update(v) { patch = v; return query; }, insert(v) { inserted = v; return query; },
      eq(k, v) { filters.push((r) => r[k] === v); return query; }, neq(k, v) { filters.push((r) => r[k] !== v); return query; },
      in(k, v) { filters.push((r) => v.includes(r[k])); return query; }, not() { return query; }, limit() { return query; },
      single() { return Promise.resolve(execute(true)); }, maybeSingle() { return Promise.resolve(execute(true)); }, then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); } };
    return query;
  }
  const supabase = { from, async rpc(name, args) {
    calls.push({ name, args });
    if (name === "claim_commercial_discovery_runs_v2") return { data: [], error: null };
    if (name === "claim_commercial_discovery_items_v2") { item.status = "processing"; return { data: [item], error: null }; }
    if (name === "reserve_commercial_france_provider_call_v1") { const id = args.p_call_kind; ledger.set(id, "reserved"); return { data: { reserved: true, call_id: id }, error: null }; }
    if (name === "finish_commercial_france_provider_call_v1") {
      assert.equal(ledger.get(args.p_call_id), "reserved", "ledger must finish exactly once");
      if (args.p_call_id === "scoring") assert.equal(analyses, 1, "AI result must precede ledger finish");
      ledger.set(args.p_call_id, args.p_status); return { data: { ok: true }, error: null };
    }
    if (name === "preflight_commercial_discovery_candidate_v1") return { data: { status: "clear" }, error: null };
    if (name === "ingest_commercial_discovery_candidate_v2") { ingested = args.p_payload; item.status = "completed"; return { data: {}, error: null }; }
    if (name === "refresh_commercial_discovery_run_v2") { run.status = "completed_with_errors"; return { data: run, error: null }; }
    if (name === "evaluate_commercial_france_run_gate_v1") return { data: { state: control.state }, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  } };
  const processor = load("discovery-processor.ts", {
    // This suite isolates provider accounting AFTER the separately tested identity gate.
    "./profile-first-anchor": { resolveProfileFirstIdentity: () => ({ scoringAllowed: true, admission: { outcome: "ADMITTED", candidate: { city: item.city, address: "", postalCode: "" } }, identity: { websites: [] } }) },
    "server-only": {}, "@/lib/supabase/admin": { createSupabaseAdminClient: forbidden },
    "@/lib/instagram-public-profile-lookup": { lookupInstagramPublicProfile: forbidden },
    "./discovery-ai": { analyzeCommercialProspect: forbidden, analyzeCommercialProspectWithRetry: forbidden },
    "./france-profile-first": { FR_PROFILE_FIRST_KEY: "fixed-experiment" }, "./discovery-contract": contract,
    "./discovery-provider": { discoverCommercialCandidates: forbidden }, "./discovery-execution": execution,
    "./discovery-scoring": { scoreCommercialProspect: () => ({ itemStatus: rejectAfterScoring ? "hard_rejected" : "qualified", hardGateCodes: [], breakdown: {} }) },
    "./discovery-reliability": { commercialSnapshotHash: () => "fixture-hash", extractObservedUrls: () => [], extractFranceCaptionDomainHints: () => [], isSharedCommercialPlatformUrl: () => false,
      extractBookingEvidence: () => ({}), filterCommercialAudiences: () => [],
      resolveCommercialLocation: () => ({ country, city: item.city, confidence: "HIGH", confidenceScore: .9, evidence: [] }),
      deterministicCommercialPrecheck: () => ({ decision: "PRECHECK_PASS", reason: "fixture_pass", evidence: [] }) },
  });
  await processor.processCommercialDiscoveryBatch({ supabase,
    loadAnchors: async () => [],
    lookupProfile: async () => ({ ok: true, status: "found", canonical_username: "fixture", metadata: { profile_name: "Safe Fixture", biography: "Paris salon" }, recent_post_captions: [], is_private: false }),
    enrichWebsite: async () => ({ pagesFetched: 0 }),
    analyze: async () => { analyses++; return { ...aiResult, attempts: 1, providerAttemptsSafe: aiResult.providerDiagnostic ? [aiResult.providerDiagnostic] : [] }; },
  });
  return { item, ledger, calls, ingested, analyses };
}

for (const status of [400, 401, 403, 429, 500, 503]) {
  test(`actual analyzer HTTP ${status} -> worker ledger FAILED, never succeeded; safe diagnostics retained`, async () => {
    const ai = await analyzeCommercialProspect({ city: "Paris", evidence: {}, apiKey: "fixture", fetchImpl: async () => new Response(JSON.stringify({ error: { code: "fixture_failure", type: "invalid_request_error" } }), { status, headers: { "x-request-id": "req_offline" } }) });
    const f = await workerFixture(ai);
    assert.equal(f.ledger.get("scoring"), "failed"); assert.equal(f.item.status, "failed");
    assert.equal(f.item.error_code, "AI_ANALYSIS_FAILED");
    assert.equal(f.item.error_detail_safe.provider_diagnostic.OPENAI_HTTP_STATUS, status);
    assert.equal(f.item.error_detail_safe.provider_attempts_safe.length, 1);
    const finishes = f.calls.filter((c) => c.name === "finish_commercial_france_provider_call_v1" && c.args.p_call_id === "scoring");
    assert.equal(finishes.length, 1); assert.equal(finishes[0].args.p_result_count, 0); assert.equal(finishes[0].args.p_error_code, ai.errorCode);
    assert.equal(f.ingested, undefined);
  });
}
test("ai.ok=false with HTTP 200 parsing failure -> existing failed ledger outcome", async () => {
  const ai = await analyzeCommercialProspect({ city: "Paris", evidence: {}, apiKey: "fixture", fetchImpl: async () => new Response("{}", { status: 200 }) });
  const f = await workerFixture(ai);
  assert.equal(f.ledger.get("scoring"), "failed"); assert.equal(f.item.error_detail_safe.provider_diagnostic.OPENAI_FAILURE_CLASS, "parsing");
});
for (const country of ["FR", "ZA"]) {
  test(`valid scoring succeeds without changing ${country} business contract or adding a ZA ledger`, async () => {
    const f = await workerFixture({ ok: true, analysis: valid, errorCode: null, model: "fixture" }, { country });
    assert.equal(f.item.status, "completed"); assert.equal(f.ingested.country_code, country);
    assert.equal(f.ingested.analysis_snapshot_safe.businessName, "Safe Fixture");
    assert.equal(f.ledger.get("scoring"), country === "FR" ? "succeeded" : undefined);
    assert.equal(f.analyses, 1);
  });
}
test("valid scoring followed by business hard-reject is NOT a provider failure", async () => {
  const f = await workerFixture({ ok: true, analysis: valid, errorCode: null, model: "fixture" }, { rejectAfterScoring: true });
  assert.equal(f.ledger.get("scoring"), "succeeded"); assert.equal(f.item.status, "rejected");
});
