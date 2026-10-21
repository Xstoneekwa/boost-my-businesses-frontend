import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const route = readFileSync(
  new URL("../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url),
  "utf8",
);
const projection = readFileSync(
  new URL("../lib/instagram-dashboard/profiles-live-projection.ts", import.meta.url),
  "utf8",
);
const canonicalProfilesRoute = readFileSync(
  new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url),
  "utf8",
);

test("live endpoint is dynamic, private no-store, and selects canonical revision", () => {
  assert.match(route, /dynamic\s*=\s*"force-dynamic"/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /getManageData\(\{ requireCanonicalComplete: true/);
  assert.match(route, /selectCanonicalVisibleProfiles\(manage\.activeAccounts\)/);
  assert.match(route, /enrichAccountsWithRuntime/);
  assert.doesNotMatch(route, /GET as getLegacyProfiles|legacyPayload/);
  assert.match(canonicalProfilesRoute, /total_story,live_counter_revision,created_at/);
  assert.match(canonicalProfilesRoute, /projection_revision:\s*projectionGeneratedAt/);
  assert.match(route, /projection_revision:\s*generatedAt/);
  assert.doesNotMatch(route, /generated_at:\s*new Date\(\)\.toISOString\(\)/);
});

const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH || "typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
const routePath = "app/api/instagram-dashboard/profiles/live/route.ts";
const profilesPath = "app/api/instagram-dashboard/profiles/route.ts";
const managePath = "app/instagram-dashboard/manage-data.ts";
const now = "2026-10-19T17:00:00.000Z";
const plain = value => JSON.parse(JSON.stringify(value));
const identities = [
  ["30a08fb1-afb2-467a-990f-fdb875b0cdf7", "autom_atism"],
  ["2cd8e47f-62ee-43b2-9534-18d9f19d814f", "bmybusinesses"],
  ["76c1dff8-d16a-40cf-83df-8138d2ca5bd4", "nab_youss"],
  ["8bdd2dde-6b14-4ca8-bd7b-bedf67302fc4", "growth_with_bmb"],
  ["b024e94e-395d-4f02-9787-81ddc679b014", "rex_gen_boost_ai"],
  ["dfe78a92-3a51-435e-8911-ed10c93a4d82", "lorielebras_autom"],
];

function harness(scenario = {}) {
  const calls = [], cache = new Map();
  const accounts = identities.map(([accountId, username], index) => ({
    accountId, username, clientId: "fixture-client", active: true, accountLifecycleStatus: "active",
    assignmentId: `assignment-${index}`, deviceId: `device-${index}`, appInstanceId: `instance-${index}`,
    assignmentStatus: "reserved", assignmentHealth: "assigned", packageLabel: "Pro",
    credentialsStatus: "active", credentialsConfigured: true, phoneName: "Fixture phone",
    loginStatus: "connected", readiness: "ready", eligibility: index === 3 || index === 4 ? "blocked_now" : "can_start",
    eligibilityReason: index === 3 || index === 4 ? "instagram_action_rate_limit" : "ready",
    scheduleMode: index === 3 || index === 4 ? "scheduled" : "manual_only",
  }));
  const ids = accounts.map(row => row.accountId);
  const inactive = Array.from({ length: 10 }, (_, index) => ({ accountId: `inactive-${index}`, active: false, accountLifecycleStatus: "inactive", loginStatus: "unknown" }));
  const overview = { allAccounts: [...accounts, ...inactive], activeAccounts: accounts, errors: [], summary: { sourceStatus: {} } };
  const tables = {
    ig_accounts: ids.map(id => ({ id, followers_count: 0 })),
    ig_account_settings: ids.map(account_id => ({ account_id, email: "fixture@example.invalid" })),
    account_package_summary: ids.map(account_id => ({ account_id, commercial_package_label: "Pro", effective_caps_preview: { follow: 120, like: 100, dm: 2 } })),
    account_assignments: ids.map((account_id, index) => ({ id: `assignment-${index}`, account_id, status: "reserved", device_id: `device-${index}`, app_instance_id: `instance-${index}`, schedule_mode: accounts[index].scheduleMode, slot_kind: accounts[index].scheduleMode })),
    phone_devices: ids.map((_id,index) => ({ id: `device-${index}`, name: "Fixture phone", status: "available" })),
    phone_app_instances: ids.map((current_account_id,index) => ({ id: `instance-${index}`, current_account_id, device_id: `device-${index}`, status: "occupied", is_launchable: true, package_name: "com.instagram.android", instance_index: index })),
    client_instagram_accounts: ids.map(account_id => ({ account_id, login_status: "connected", login_identity_proof_status: "verified", login_identity_profile_opened: true, login_identity_username_match: true, login_identity_verified_at: now })),
    account_credentials: [], ig_action_logs: [], account_run_requests: [], ig_runs: [], ig_interaction_events: [], ig_interacted_users: [], account_session_transitions: [],
  };
  if (scenario.missingAssignment) tables.account_assignments = [];
  if (scenario.conflictingAssignment) tables.account_assignments.push({ ...tables.account_assignments[0], id: "conflicting-id" });
  const query = table => {
    let fields = "*", filters = [], signal, retry, offset = 0, end = Infinity;
    const q = {
      select(value) { fields = value; return q; }, in(key, values) { filters.push(row => values.includes(row[key])); return q; },
      eq(key,value) { filters.push(row => row[key] === value); return q; }, gte(key,value) { filters.push(row => row[key] >= value); return q; },
      lte(key,value) { filters.push(row => row[key] <= value); return q; }, range(lo,hi) { offset = lo; end = hi; return q; },
      order() { return q; }, limit() { return q; }, retry(value) { retry = value; return q; }, abortSignal(value) { signal = value; return q; },
      then(resolve,reject) {
        calls.push({ table, fields, retry, signal: Boolean(signal) });
        const run = async () => {
          if (table === scenario.failTable) return { data: null, error: { message: "fixture provider failure", status: 503 } };
          if (table === scenario.nullTable) return { data: null, error: null };
          if (table === scenario.waitTable) return new Promise((_resolve, reject) => {
            if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
            signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
          let rows = (tables[table] || []).filter(row => filters.every(fn => fn(row)));
          const count = rows.length; rows = rows.slice(offset, end + 1);
          if (fields !== "*") rows = rows.map(row => Object.fromEntries(fields.split(",").filter(key => key in row).map(key => [key,row[key]])));
          return { data: plain(rows), error: null, count };
        };
        return run().then(resolve,reject);
      },
    }; return q;
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Date.parse(now); } }
  const context = vm.createContext({ Date: FixedDate, Request, Response, Headers, URL, DOMException, AbortController, AbortSignal, TextEncoder, Buffer, performance, setTimeout, clearTimeout,
    fetch() { throw new Error("unexpected external fetch"); },
    console: { info() {}, warn() {}, error() {} }, process: { env: {} } });
  const utils = { jsonError: (message,status) => Response.json({ ok: false,error: message }, { status }), jsonOk: data => Response.json({ ok: true,data }), requireInstagramAdmin: async () => Response.json({ ok: false }, { status: 401 }) };
  function load(relative, realManage = false) {
    if (relative === "lib/supabase.ts") return { createSupabaseClient: () => ({ from: query, rpc: (name, parameters) => {
        if (name !== "read_last_complete_growth_snapshots_v1") throw new Error("unexpected RPC");
        assert.deepEqual(plain(parameters.p_account_ids), ids);
        assert.equal(parameters.p_until, now);
        return query(`rpc:${name}`);
      } }) };
    if (cache.has(relative)) return cache.get(relative).exports;
    const module = { exports: {} }; cache.set(relative,module);
    const localRequire = specifier => {
      if (specifier === "@/lib/supabase") return { createSupabaseClient: () => ({ from: query, rpc: (name, parameters) => {
        if (name !== "read_last_complete_growth_snapshots_v1") throw new Error("unexpected RPC");
        assert.deepEqual(plain(parameters.p_account_ids), ids);
        assert.equal(parameters.p_until, now);
        return query(`rpc:${name}`);
      } }) };
      if (specifier === "@/app/instagram-dashboard/manage-data" && !realManage) return { getManageData: async () => {
        calls.push({ table: "manage", readOnly: true });
        if (scenario.sharedFail) throw new Error("fixture shared read unavailable");
        return plain(scenario.membershipError ? { ...overview,errors: ["incomplete"] } : overview);
      } };
      if (specifier === "@/app/api/instagram-dashboard/_utils" || (relative === profilesPath && specifier === "../_utils")) return utils;
      if (relative === profilesPath && specifier === "../compass/relay-auth") return { verifyCompassRelayKey: () => scenario.unauthorized ? { ok: false } : { ok: true,mode: "relay_key" }, compassRelayAuthFailureReason: () => "unauthorized", relayAuthStatus: () => 401 };
      if (specifier === "@/lib/instagram-dashboard/profiles-live-causal-context") return { causalFetch() { throw new Error("unexpected external fetch"); }, traceStep: (_name,work) => work(), traceMetric() {}, traceFallback() {} };
      if (relative === managePath && specifier === "./package-summary-data") return { getAccountPackageSummaries() { throw new Error("unexpected package request"); } };
      // The retained modern observer imports only these passive primitives.
      if (specifier === "node:diagnostics_channel") return { channel: require(specifier).channel };
      if (specifier === "node:net") return { isIP: require(specifier).isIP };
      if (specifier.startsWith("node:")) {
        if (!["node:async_hooks","node:crypto"].includes(specifier)) throw new Error(`forbidden module ${specifier}`);
        return require(specifier);
      }
      let resolved = specifier.startsWith("@/") ? specifier.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(relative),specifier));
      if (!path.posix.extname(resolved)) resolved += ".ts";
      return load(resolved,realManage);
    };
    const source = readFileSync(path.join(root,relative),"utf8");
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022 },fileName: relative }).outputText;
    const inspect = relative === managePath ? "\nmodule.exports.inspectAssignmentProjection = enrichWithAssignmentAndCredentialStatus;" : "";
    vm.runInContext(`(function(require,module,exports){${js}${inspect}\n})`,context,{ filename: relative })(localRequire,module,module.exports);
    return module.exports;
  }
  return { calls,accounts,overview,tables,load,
    async run() { const response = await load(routePath).GET(new Request(`https://fixture.invalid/api/instagram-dashboard/profiles/live?account_ids=${ids.join(",")}`,{ headers: { "X-Profiles-Live-Contract": "freshness-v1" } })); return { status: response.status,body: await response.json() }; },
  };
}

test("exact GET emits complete membership, read coverage and current per-family tuple proofs", async () => {
  const h = harness(), result = await h.run(), data = result.body.data;
  assert.equal(result.status,200);
  assert.equal(data.contract,"freshness-v1");
  assert.equal(data.schema_version,"profiles_live_v1");
  assert.equal(data.projection_state,"COMPLETE");
  assert.equal(data.membership.schema,"profiles_membership_v1");
  assert.equal(data.profiles.length,6);
  assert.equal(data.freshness.read_coverage.runtime_account_ids.length,6);
  for (const row of data.profiles) {
    assert.equal(row.loginStatus,"connected");
    for (const family of ["security","runtime","assignment"]) {
      const proof = data.freshness.profiles[row.accountId][family];
      assert.equal(proof.data_state,"FRESH");
      assert.equal(proof.fence.assignment_id,row.assignmentId);
      assert.equal(proof.fence.device_id,row.deviceId);
      assert.equal(proof.fence.app_instance_id,row.appInstanceId);
    }
  }
  assert.equal(data.profiles.filter(row => row.scheduleMode === "manual_only").length,4);
  assert.equal(data.profiles.filter(row => row.eligibility === "blocked_now").length,2);
  assert.ok(h.calls.filter(c => c.table !== "manage").every(c => c.retry === false && c.signal));
});

test("every runtime provider failure or null envelope produces UNKNOWN instead of false FRESH", async () => {
  for (const table of ["ig_account_settings","ig_action_logs","account_package_summary","account_session_resume_plans","ig_account_social_profile_snapshots","rpc:read_last_complete_growth_snapshots_v1","account_run_requests","ig_runs","ig_interaction_events","ig_interacted_users","account_session_transitions"]) {
    for (const key of ["failTable","nullTable"]) {
      const result = await harness({ [key]: table }).run(), data = result.body.data;
      assert.equal(result.status,200,`${key}:${table}`);
      assert.equal(data.projection_state,"PARTIAL",`${key}:${table}`);
      for (const row of data.profiles) for (const family of ["security","runtime","counters"]) assert.equal(data.freshness.profiles[row.accountId][family].data_state,"UNKNOWN");
    }
  }
});

test("incomplete shared membership is unavailable and never publishes current rows", async () => {
  for (const scenario of [{ sharedFail: true },{ membershipError: true }]) {
    const result = await harness(scenario).run(), data = result.body.data;
    assert.equal(result.status,503);
    assert.equal(data.projection_state,"UNAVAILABLE");
    assert.equal(data.freshness.membership.data_state,"UNKNOWN");
    assert.equal(Object.hasOwn(data,"profiles"),false);
  }
});

test("runtime deadline aborts existing provider reads and preserves unknown truth", async () => {
  const h = harness({ waitTable: "ig_runs" });
  const started = performance.now(), result = await h.run();
  assert.ok(performance.now() - started < 4500);
  assert.equal(result.body.data.projection_state,"PARTIAL");
  for (const row of result.body.data.profiles) assert.equal(result.body.data.freshness.profiles[row.accountId].security.data_state,"UNKNOWN");
});

test("unauthenticated Profiles request makes zero provider reads", async () => {
  const h = harness({ unauthorized: true }), result = await h.run();
  assert.equal(result.status,401);
  assert.deepEqual(h.calls,[]);
});

test("assignment ID comes from the same selected canonical row and never stale fallback", async () => {
  for (const scenario of [{},{ missingAssignment: true },{ conflictingAssignment: true }]) {
    const h = harness(scenario);
    const manage = h.load(managePath,true);
    const enriched = plain(await manage.inspectAssignmentProjection(h.overview));
    assert.equal(enriched.errors.length,0);
    for (const row of enriched.activeAccounts) {
      const selected = h.tables.account_assignments.find(a => a.account_id === row.accountId);
      assert.equal(row.assignmentId,selected?.id ?? null);
      if (selected) {
        assert.equal(row.deviceId,selected.device_id);
        assert.equal(row.appInstanceId,selected.app_instance_id);
      }
    }
    assert.ok(h.calls.some(call => call.table === "account_assignments" && call.fields.startsWith("id,account_id,")));
    if (scenario.conflictingAssignment) assert.equal(enriched.activeAccounts[0].assignmentHealth,"requires_attention");
  }
});

test("live payload is account and run scoped with canonical ack metadata", () => {
  assert.match(projection, /accountId:\s*id/);
  assert.match(projection, /runId:\s*text\(run\.id\) \|\| null/);
  assert.match(projection, /revision:\s*nonNegativeInteger\(run\.live_counter_revision\)/);
  assert.match(projection, /source:\s*"canonical_ack"/);
  assert.match(projection, /updatedAt:\s*rowTime\(run\) \|\| null/);
});
