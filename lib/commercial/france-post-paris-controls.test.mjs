import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const forbidden = () => { throw new Error("Unexpected provider or external dependency in offline test"); };
function load(name, imports) {
  const output = ts.transpileModule(source(name), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  runInNewContext(output, { module: loaded, exports: loaded.exports, require(id) {
    if (!(id in imports)) throw new Error(`Unmocked import: ${id}`);
    return imports[id];
  }, process: { env: {} }, crypto: { ...webcrypto, subtle: webcrypto.subtle, randomUUID }, TextEncoder, Date, setTimeout });
  return loaded.exports;
}
const market = load("market-config.ts", {});
const contract = load("discovery-contract.ts", { "./market-config.ts": market });
const execution = load("discovery-execution.ts", {});

function fixture({ volume = 10, limit = volume, country = "FR", controlState = "running", finalStatus, gateState, stopDuringProfile = false } = {}) {
  const run = { id: "fixture-run", status: "running", country_code: country };
  const control = country === "FR" ? { run_id: run.id, state: controlState, budget_limits_safe: { public_profiles: limit } } : null;
  const items = Array.from({ length: volume }, (_, index) => ({ id: `fixture-item-${index}`, run_id: run.id,
    city: country === "FR" ? "Paris" : "Johannesburg", provider_external_id: `fixture${index}`, status: "pending", attempt_count: 0, max_attempts: 3,
    source_snapshot_safe: { instagram_handle: `fixture${index}` } }));
  const tables = { commercial_discovery_runs: [run], commercial_france_run_controls: control ? [control] : [], commercial_discovery_items: items, commercial_discovery_audit_events: [] };
  const calls = []; const reservations = new Map(); let profileCalls = 0;
  function from(table) {
    assert.ok(table in tables, `Unexpected table ${table}`);
    const filters = []; let patch; let inserted;
    function execute(single = false) {
      let rows = tables[table].filter((row) => filters.every((f) => f(row)));
      if (patch) rows.forEach((row) => Object.assign(row, patch));
      if (inserted) tables[table].push(inserted);
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    const query = {
      select() { return query; }, update(value) { patch = value; return query; }, insert(value) { inserted = value; return query; },
      eq(key, value) { filters.push((row) => row[key] === value); return query; },
      neq(key, value) { filters.push((row) => row[key] !== value); return query; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
      maybeSingle() { return Promise.resolve(execute(true)); }, single() { return Promise.resolve(execute(true)); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    return query;
  }
  const supabase = { from, async rpc(name, args) {
    calls.push({ name, args });
    if (name === "claim_commercial_discovery_runs_v2") return { data: [], error: null };
    if (name === "claim_commercial_discovery_items_v2") {
      const blocked = control && !["armed", "running"].includes(control.state);
      const claimed = blocked || run.status !== "running" ? [] : items.filter((i) => i.status === "pending").slice(0, args.batch_limit);
      claimed.forEach((i) => { i.status = "processing"; i.attempt_count += 1; });
      return { data: claimed, error: null };
    }
    if (name === "reserve_commercial_france_provider_call_v1") {
      assert.equal(args.p_call_kind, "profile");
      if (reservations.has(args.p_call_key)) return { data: { reserved: false, reason: "idempotent_replay" }, error: null };
      if (reservations.size >= limit) return { data: { reserved: false, reason: "budget_exceeded", used: reservations.size, limit }, error: null };
      reservations.set(args.p_call_key, args.p_call_key);
      return { data: { reserved: true, call_id: args.p_call_key }, error: null };
    }
    if (name === "finish_commercial_france_provider_call_v1") return { data: { ok: true }, error: null };
    if (name === "refresh_commercial_discovery_run_v2") {
      run.status = finalStatus ?? (items.some((i) => ["pending", "processing", "retry_scheduled"].includes(i.status)) ? "running" : "completed");
      return { data: run, error: null };
    }
    if (name === "evaluate_commercial_france_run_gate_v1") {
      if (gateState) control.state = gateState;
      return { data: { state: control.state }, error: null };
    }
    if (name === "cancel_commercial_discovery_run_v2") { run.status = "cancelled"; return { data: run, error: null }; }
    throw new Error(`Unexpected RPC ${name}`);
  } };
  const processor = load("discovery-processor.ts", {
    "server-only": {}, "@/lib/supabase/admin": { createSupabaseAdminClient: () => supabase },
    "@/lib/instagram-public-profile-lookup": { lookupInstagramPublicProfile: forbidden },
    "./discovery-ai": { analyzeCommercialProspect: forbidden, analyzeCommercialProspectWithRetry: forbidden },
    "./france-profile-first": { FR_PROFILE_FIRST_KEY: "fixture-profile-first" }, "./discovery-contract": contract,
    "./discovery-provider": { discoverCommercialCandidates: forbidden }, "./discovery-scoring": { scoreCommercialProspect: forbidden },
    "./discovery-reliability": {
      resolveCommercialLocation: () => ({ country, city: "fixture-city", confidence: "LOW", confidenceScore: 0, evidence: [] }),
      deterministicCommercialPrecheck: () => ({ decision: "PRECHECK_REJECT", reason: "fixture_rejection", evidence: [] }),
    }, "./discovery-execution": execution,
  });
  async function batch() {
    return processor.processCommercialDiscoveryBatch({ supabase, lookupProfile: async () => {
      profileCalls += 1;
      if (stopDuringProfile && control) control.state = "stopped";
      return { ok: true, status: "found", metadata: { profile_name: "Fixture", biography: "" }, recent_post_captions: [] };
    } });
  }
  return { run, control, items, calls, reservations, processor, batch, get profileCalls() { return profileCalls; } };
}

for (const volume of [10, 17, 30, 50]) {
  test(`France volume ${volume}: create RPC derives exactly N profile units, no other budget override`, async () => {
    let request;
    const service = load("discovery-service.ts", { "server-only": {}, "@/lib/supabase/admin": { createSupabaseAdminClient: () => ({ rpc: async (name, args) => { request = { name, args }; return { data: { id: "new-fixture" }, error: null }; } }) },
      "./crm-access": { requireCommercialCrmAccess: async () => ({ userId: "fixture-owner" }) }, "./market-config": market });
    await service.createCommercialDiscoveryRun(contract.parseCommercialDiscoveryTrigger({ countryCode: "FR", city: "Any approved city", maxProspects: volume, subsegment: null, idempotencyKey: "commercial-france-fixture-v2" }));
    assert.equal(request.name, "create_commercial_france_canary_run_v1");
    assert.equal(request.args.p_budget_limits_safe.public_profiles, volume);
    assert.deepEqual(Object.keys(request.args.p_budget_limits_safe), ["public_profiles"]);
  });
}

test("ten candidates can each consume one profile lookup, with no margin or failure", async () => {
  const f = fixture();
  await f.batch(); await f.batch();
  assert.equal(f.profileCalls, 10);
  assert.equal(f.reservations.size, 10);
  assert.ok(f.items.every((i) => i.status === "rejected" && i.error_code === undefined));
  assert.equal(f.control.state, "completed");
});

test("real exhaustion refuses before provider, holds the run and records SKIPPED_BY_BUDGET without retry", async () => {
  const f = fixture({ volume: 11, limit: 10 });
  await f.batch(); await f.batch(); await f.batch();
  assert.equal(f.profileCalls, 10);
  assert.equal(f.reservations.size, 10);
  assert.equal(f.control.state, "hold");
  assert.equal(f.control.stop_code, "profile_budget_exhausted");
  const skipped = f.items.filter((i) => i.error_code === "skipped_by_budget");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].status, "cancelled");
  assert.equal(skipped[0].error_detail_safe.reason, "budget_exhausted");
  assert.equal(skipped[0].next_attempt_at, null);
  const attempts = f.items.map((i) => i.attempt_count);
  await f.batch();
  assert.equal(f.profileCalls, 10);
  assert.deepEqual(f.items.map((i) => i.attempt_count), attempts);
});

test("concurrent budget refusals do not exceed a smaller explicit cap or become generic failures", async () => {
  const f = fixture({ volume: 10, limit: 1 });
  await f.batch(); await f.batch();
  assert.equal(f.profileCalls, 1);
  assert.equal(f.reservations.size, 1);
  assert.equal(f.control.state, "hold");
  assert.ok(f.items.some((i) => i.error_code === "skipped_by_budget"));
  assert.ok(f.items.every((i) => i.status !== "failed" && i.status !== "retry_scheduled"));
});

for (const [status, state] of [["completed", "completed"], ["completed_with_errors", "completed"], ["partial", "completed"], ["failed", "stopped"], ["cancelled", "cancelled"]]) {
  test(`terminal run ${status} synchronizes the existing control to ${state}`, async () => {
    const f = fixture({ volume: 1, finalStatus: status });
    await f.batch();
    assert.equal(f.run.status, status);
    assert.equal(f.control.state, state);
  });
}

for (const state of ["hold", "stopped", "cancelled"]) {
  test(`existing ${state} is never reopened or cleared by the finalizer`, async () => {
    const f = fixture({ volume: 1, controlState: state });
    f.control.stop_code = "existing-safety-reason";
    await f.batch();
    assert.equal(f.profileCalls, 0);
    assert.equal(f.control.state, state);
    assert.equal(f.control.stop_code, "existing-safety-reason");
    assert.equal(f.calls.filter((c) => c.name === "evaluate_commercial_france_run_gate_v1").length, 0);
  });
}
for (const gateState of ["hold", "stopped"]) {
  test(`a gate establishing ${gateState} on completion wins over terminal synchronization`, async () => {
    const f = fixture({ volume: 1, finalStatus: "completed", gateState });
    await f.batch();
    assert.equal(f.control.state, gateState);
  });
}

for (const country of ["FR", "ZA"]) {
  test(`owner cancellation synchronizes France only, without starting providers (${country})`, async () => {
    const f = fixture({ volume: 1, country });
    await f.processor.cancelCommercialDiscoveryRun(f.run.id, "fixture-owner");
    assert.equal(f.run.status, "cancelled");
    assert.equal(f.profileCalls, 0);
    if (country === "FR") assert.equal(f.control.state, "cancelled");
    else assert.equal(f.calls.some((c) => /france/.test(c.name)), false);
  });
}

test("ZA processing and create payload remain free of France budgets/gates", async () => {
  const f = fixture({ volume: 1, country: "ZA" });
  await f.batch();
  assert.equal(f.profileCalls, 1);
  assert.equal(f.reservations.size, 0);
  assert.equal(f.calls.some((c) => /france/.test(c.name)), false);
  let request;
  const service = load("discovery-service.ts", { "server-only": {}, "@/lib/supabase/admin": { createSupabaseAdminClient: () => ({ rpc: async (name, args) => { request = { name, args }; return { data: {}, error: null }; } }) },
    "./crm-access": { requireCommercialCrmAccess: async () => ({ userId: "fixture-owner" }) }, "./market-config": market });
  await service.createCommercialDiscoveryRun({ countryCode: "ZA", city: "Johannesburg", maxProspects: 10, idempotencyKey: "commercial-discovery:fixture", forceRescore: false });
  assert.equal(request.name, "create_commercial_discovery_run_v2");
  assert.equal("p_budget_limits_safe" in request.args, false);
});

test("V2 is unchanged; an owner-authorized V3 is already accepted, never automatically generated", async () => {
  const scope = { countryCode: "FR", city: "Paris", maxProspects: 10, subsegment: null };
  const v2 = await contract.buildCommercialFranceDiscoveryIdempotencyKey(scope);
  const v3 = v2.replace(/-v2$/, "-v3");
  assert.notEqual(v2, v3);
  assert.equal(contract.parseCommercialDiscoveryTrigger({ ...scope, idempotencyKey: v3 }).idempotencyKey, v3);
  assert.equal(await contract.buildCommercialFranceDiscoveryIdempotencyKey(scope), v2);
  assert.throws(() => contract.parseCommercialDiscoveryTrigger({ ...scope, maxProspects: 51, idempotencyKey: v3 }), /max_invalid/);
});

test("existing DB guards remain bounded/idempotent and retain immutable historical controls", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20261007204919_commercial_france_canary_controls_v1.sql", import.meta.url), "utf8");
  assert.match(migration, /v_limit <= v_used then return jsonb_build_object\('reserved',false,'reason','budget_exceeded'/);
  assert.match(migration, /where run_id = p_run_id for update/);
  assert.match(migration, /on conflict \(run_id\) do nothing/);
  assert.match(migration, /'idempotent_replay', v_inserted = 0/);
});

test("a batch touched before a concurrent STOP still invokes its canonical finalizer without reopening", async () => {
  const f = fixture({ stopDuringProfile: true });
  await f.batch();
  assert.equal(f.control.state, "stopped");
  // Both concurrent requests may already have started before STOP is observed.
  assert.ok(f.profileCalls > 0 && f.profileCalls <= 2);
  const callsBeforeReplay = f.profileCalls;
  assert.equal(f.calls.filter(c => c.name === "evaluate_commercial_france_run_gate_v1").length, 1);
  assert.ok(f.calls.findIndex(c => c.name === "evaluate_commercial_france_run_gate_v1")
    < f.calls.findIndex(c => c.name === "refresh_commercial_discovery_run_v2"));
  await f.batch();
  assert.equal(f.profileCalls, callsBeforeReplay);
  assert.equal(f.calls.filter(c => c.name === "evaluate_commercial_france_run_gate_v1").length, 1);
});
