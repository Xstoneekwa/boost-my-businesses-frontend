import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import * as anchorContract from "./profile-first-anchor.ts";
import * as reliability from "./discovery-reliability.ts";
import * as execution from "./discovery-execution.ts";

const at = "2026-10-19T15:00:00Z";
const forbidden = () => { throw Error("No real provider allowed"); };
async function fixture({ country = "FR", anchored = false, circular = false, phoneOnly = false, websiteUrl = "https://salon.example/", privateProfile = false } = {}) {
  const run = { id: "run-offline", country_code: country, status: "running" };
  const control = { run_id: run.id, state: "running" };
  const item = { id: "item-offline", run_id: run.id, city: country === "FR" ? "Paris" : "Cape Town", provider_external_id: "salon_fixture", status: "pending", attempt_count: 1, max_attempts: 3,
    source_snapshot_safe: { instagram_handle: "salon_fixture", profile_url: "https://instagram.com/salon_fixture/", title: "Salon Fixture", snippet: country === "FR" ? "Institut de beauté à Paris" : "Beauty salon Cape Town" } };
  const c = { provider: "authorized_registry_fixture", externalId: "EST-1", businessName: "Salon Fixture", country: "FR", city: "Paris", address: phoneOnly ? "" : "12 rue Exemple", postalCode: phoneOnly ? "" : "75018", department: "75",
    verifiedPhone: phoneOnly ? "0100000000" : undefined,
    activity: { code: "", nomenclature: "", label: "Beauty" }, eligibility: { prospectingEligible: true, checkedAt: at, reason: "existing", policyVersion: "existing", establishmentDiffusion: "O", legalUnitDiffusion: "O" },
    source: { url: circular ? websiteUrl : "https://registry.example/establishment/EST-1", license: "fixture", attribution: "fixture", observedAt: at } };
  const tables = { commercial_discovery_runs: [run], commercial_france_run_controls: country === "FR" ? [control] : [], commercial_discovery_items: [item], commercial_discovery_audit_events: [],
    commercial_businesses: anchored ? [{ identity_mode: "structured", country_code: "FR", city: "Paris", metadata_safe: { structured_discovery: c } }] : [] };
  const reads = [], calls = [], ledger = new Map(); let scoring = 0, lookups = 0, siteReads = 0;
  const from = name => {
    assert.ok(name in tables, name); reads.push(name);
    let patch, insert, cap = Infinity; const filters = [];
    const execute = single => {
      const rows = tables[name].filter(r => filters.every(f => f(r))).slice(0, cap);
      if (patch) rows.forEach(r => Object.assign(r, patch)); if (insert) tables[name].push(insert);
      return { data: single ? rows[0] ?? null : rows, error: null };
    };
    const q = { select: () => q, update: v => { patch = v; return q; }, insert: v => { insert = v; return q; },
      eq: (k, v) => { filters.push(r => r[k] === v); return q; }, neq: (k, v) => { filters.push(r => r[k] !== v); return q; },
      in: (k, v) => { filters.push(r => v.includes(r[k])); return q; }, limit: v => { cap = v; return q; },
      single: async () => execute(true), maybeSingle: async () => execute(true), then: (yes, no) => Promise.resolve(execute(false)).then(yes, no) };
    return q;
  };
  const supabase = { from, async rpc(name, args) {
    calls.push({ name, args });
    if (name === "claim_commercial_discovery_runs_v2") return { data: [], error: null };
    if (name === "claim_commercial_discovery_items_v2") return { data: [item], error: null };
    if (name === "reserve_commercial_france_provider_call_v1") { ledger.set(args.p_call_kind, "reserved"); return { data: { reserved: true, call_id: args.p_call_kind }, error: null }; }
    if (name === "finish_commercial_france_provider_call_v1") { ledger.set(args.p_call_id, args.p_status); return { data: {}, error: null }; }
    if (name === "preflight_commercial_discovery_candidate_v1") return { data: { status: "clear" }, error: null };
    if (name === "refresh_commercial_discovery_run_v2") { run.status = "completed"; return { data: run, error: null }; }
    if (name === "evaluate_commercial_france_run_gate_v1") return { data: {}, error: null };
    throw Error(`Unexpected RPC ${name}`);
  } };
  const imports = { "server-only": {}, "@/lib/supabase/admin": { createSupabaseAdminClient: forbidden },
    "@/lib/instagram-public-profile-lookup": { lookupInstagramPublicProfile: forbidden },
    "./discovery-ai": { analyzeCommercialProspect: forbidden, analyzeCommercialProspectWithRetry: forbidden },
    "./discovery-contract": {}, "./discovery-provider": { discoverCommercialCandidates: forbidden }, "./france-profile-first": { FR_PROFILE_FIRST_KEY: "offline-other" },
    "./profile-first-anchor": anchorContract, "./discovery-reliability": reliability, "./discovery-execution": execution, "./discovery-scoring": { scoreCommercialProspect: forbidden } };
  const source = ts.transpileModule(readFileSync(new URL("./discovery-processor.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  runInNewContext(source, { module: m, exports: m.exports, require: id => { assert.ok(id in imports, id); return imports[id]; }, process: { env: {} }, crypto: { randomUUID }, Date, setTimeout });
  await m.exports.processCommercialDiscoveryBatch({ supabase,
    lookupProfile: async () => { lookups++; return { ok: true, status: "found", canonical_username: "salon_fixture", is_private: privateProfile, checked_at: at,
      metadata: { profile_name: "Salon Fixture", biography: country === "FR" ? "Institut de beauté Paris 16e" : "Beauty salon Cape Town" }, recent_post_captions: ["Réservez salon.example"], external_url: websiteUrl }; },
    enrichWebsite: async () => { siteReads++; return { websiteUrl, pagesFetched: 1, evidence: [websiteUrl], description: "Salon Fixture institut de beauté", address: country === "FR" ? "12 rue Exemple 75018 Paris, France" : "Cape Town", bookingUrl: null, bookingProvider: null,
      identityPages: [{ url: websiteUrl, text: "Salon Fixture 12 rue Exemple 75018 Paris", links: ["https://instagram.com/salon_fixture/"] }], socialLinks: [{ url: "https://instagram.com/salon_fixture/", sourcePage: websiteUrl }] }; },
    analyze: async () => { scoring++; return { ok: false, analysis: null, errorCode: "schema_invalid", attempts: 1, model: "offline" }; },
  });
  return { item, calls, reads, ledger, scoring, lookups, siteReads, control };
}
test("actual FR worker: no anchor => terminal review HOLD, no scoring, no identity LOW or business creation", async () => {
  const f = await fixture(); assert.equal(f.item.status, "possible_duplicate"); assert.equal(f.item.error_code, "INSUFFICIENT_ANCHOR");
  assert.equal(f.item.enrichment_snapshot_safe.profile_first.admission.outcome, "HOLD"); assert.equal(f.item.enrichment_snapshot_safe.profile_first.identity, null);
  assert.equal(f.item.website_url, null); assert.equal(f.scoring, 0); assert.equal(f.ledger.has("scoring"), false); assert.equal(f.item.next_attempt_at, null);
  assert.equal(f.calls.some(c => /ingest|create_structured|reserve_structured/.test(c.name)), false); assert.equal(f.control.state, "completed");
});
test("actual FR worker: candidate site's own address cannot become a structured anchor", async () => {
  const f = await fixture({ anchored: true, circular: true }); assert.equal(f.item.error_code, "INSUFFICIENT_ANCHOR"); assert.equal(f.scoring, 0);
});
test("actual FR worker: existing independent structured record + certified site link reaches canonical scoring", async () => {
  const f = await fixture({ anchored: true }); assert.equal(f.scoring, 1); assert.equal(f.item.error_code, "AI_ANALYSIS_FAILED");
  assert.equal(f.item.enrichment_snapshot_safe.profile_first.identity.match.confidence, "HIGH"); assert.equal(f.item.website_url, "https://salon.example/");
  assert.equal(f.ledger.get("scoring"), "failed"); assert.equal(f.lookups, 1); assert.equal(f.siteReads, 1);
});
test("actual FR worker: admitted phone-only anchor does not bypass unchanged V2 requirements", async () => {
  const f = await fixture({ anchored: true, phoneOnly: true }); assert.equal(f.scoring, 0); assert.equal(f.item.enrichment_snapshot_safe.profile_first.admission.outcome, "ADMITTED");
});
for (const url of ["https://iarabeauty.com/pro/fixture", "https://wa.me/fixture", "https://t.me/fixture"]) test(`actual FR worker: ${new URL(url).hostname} classified, never official`, async () => {
  const f = await fixture({ websiteUrl: url }); assert.equal(f.item.website_url, null); assert.equal(f.scoring, 0);
  assert.equal(f.item.enrichment_snapshot_safe.websiteClassification, url.includes("iara") ? "THIRD_PARTY_BOOKING" : "CONTACT_PLATFORM");
});
test("actual ZA worker: no France anchor read/gate; original scoring path and website behavior unchanged", async () => {
  const f = await fixture({ country: "ZA" }); assert.equal(f.scoring, 1); assert.equal(f.reads.includes("commercial_businesses"), false);
  assert.equal(f.item.enrichment_snapshot_safe.profile_first, undefined); assert.equal(f.ledger.size, 0);
});
