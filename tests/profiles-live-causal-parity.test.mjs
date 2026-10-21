import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH || "typescript");
const root = fileURLToPath(new URL("../", import.meta.url));
const BASE = "be080666ce18ae28ee660ee578980c8aa935d01c";
const ROUTE = "app/api/instagram-dashboard/profiles/live/route.ts";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const FIXED = "2026-09-09T17:00:00.000Z";
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Load the real GET and its real pure projection helpers from either exact
// production Git objects or candidate files. Only external I/O is mocked.
function harness(revision, scenario) {
  const calls = [], logs = [], cache = new Map();
  const shared = deferred(), runtime = deferred();
  let runtimeCalls = 0;
  const profiles = scenario.empty ? [] : [
    { accountId: A, username: "fixture-a", accountLifecycleStatus: "active", packageLabel: "Premium", connected: true,
      operationalBlocker: { reasonCode: "instagram_restriction_active", label: "48H pause required", blocking: true } },
    { accountId: B, username: "fixture-b", accountLifecycleStatus: "active", packageLabel: "Growth", connected: false },
  ];
  const manage = { allAccounts: profiles, activeAccounts: profiles, errors: [] };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [FIXED])); }
    static now() { return Date.parse(FIXED); }
  }
  const context = vm.createContext({
    Date: FixedDate, performance: { now: () => 100 }, Response, Request, URL, Headers,
    TextEncoder, Buffer, process: { env: {} }, console: { info: (...args) => logs.push(args) },
  });
  function source(relative) {
    return revision === "candidate" ? readFileSync(path.join(root, relative), "utf8")
      : execFileSync("git", ["-C", root, "show", `${revision}:${relative}`], { encoding: "utf8" });
  }
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const module = { exports: {} };
    cache.set(relative, module);
    const localRequire = (specifier) => {
      if (specifier === "node:crypto") return { randomUUID: () => "33333333-3333-4333-8333-333333333333" };
      if (specifier.startsWith("node:")) return require(specifier);
      if (specifier === "@/app/api/instagram-dashboard/_utils") return {
        jsonError: (message, status) => Response.json({ ok: false, error: message }, { status }),
      };
      if (specifier === "@/app/instagram-dashboard/manage-data") return {
        getManageData: (options) => { calls.push(["shared:start", plain(options)]); return shared.promise; },
      };
      if (relative === ROUTE && specifier === "../route") return {
        requireProfilesReadAccess: async () => {
          calls.push(["auth"]);
          return scenario.unauthorized ? Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) : null;
        },
        enrichAccountsWithRuntime: (rows, generatedAt) => {
          runtimeCalls++;
          calls.push(["runtime:start", plain(rows), generatedAt]);
          if (runtimeCalls === 1 && scenario.ids !== "") return runtime.promise;
          if (scenario.fallbackError) return Promise.reject(new TypeError("fixture fallback failure"));
          return Promise.resolve(rows.map((row) => ({ accountId: row.accountId, capsSource: "account_package_summary", countersToday: { follows: 7 } })));
        },
      };
      let resolved = specifier.startsWith("@/") ? specifier.slice(2)
        : path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
      if (!resolved.endsWith(".ts")) resolved += ".ts";
      return load(resolved);
    };
    const js = ts.transpileModule(source(relative), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: relative,
    }).outputText;
    vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename: relative })(localRequire, module, module.exports);
    return module.exports;
  }
  const get = load(ROUTE).GET;
  const ids = scenario.ids ?? `${A},${B}`;
  const request = new Request(`https://fixture.invalid/profiles/live?account_ids=${ids}&refresh_mode=light&correlation_id=fixture`, {
    headers: scenario.explicitId ? { "x-profiles-live-request-id": "fixture-request" } : {},
  });
  const pending = get(request);
  return { calls, logs, pending, shared, runtime, manage,
    runtimeRows: profiles.filter((p) => !scenario.missing || p.accountId === A).map((p) => ({
      accountId: p.accountId, capsSource: scenario.packageFallback && p.accountId === A ? "fallback" : "account_package_summary",
      countersToday: { follows: 7 },
    })),
  };
}

async function execute(revision, scenario = {}) {
  const h = harness(revision, scenario);
  await tick();
  if (!scenario.unauthorized) {
    assert.equal(h.calls[1][0], "shared:start");
    if (scenario.ids !== "") {
      assert.equal(h.calls[2][0], "runtime:start", "requested runtime must start while shared core is unresolved");
      assert.equal(h.calls.length, 3, "neither missing nor fallback batch may run before shared resolves");
    }
    if (scenario.sharedError) {
      h.runtime.resolve(h.runtimeRows);
      h.shared.reject(new TypeError("fixture shared failure"));
    } else if (scenario.runtimeFirst) {
      h.runtime.resolve(h.runtimeRows);
      await tick();
      h.shared.resolve(h.manage);
    } else {
      h.shared.resolve(h.manage);
      await tick();
      if (scenario.runtimeError) h.runtime.reject(new TypeError("fixture runtime failure"));
      else h.runtime.resolve(h.runtimeRows);
    }
  }
  const response = await h.pending;
  const body = await response.text();
  return { status: response.status, headers: Object.fromEntries(response.headers), body, calls: plain(h.calls),
    legacyEvents: h.logs.filter(([label]) => label === "PROFILES_LIVE_TELEMETRY").map(([, text]) => JSON.parse(text)),
    causalEvents: h.logs.filter(([label]) => label === "PROFILES_LIVE_CAUSAL_V2").map(([, text]) => JSON.parse(text)),
  };
}

for (const [name, scenario] of Object.entries({
  "shared resolves first": {},
  "runtime resolves first": { runtimeFirst: true },
  "new account requires missing batch": { ids: A, missing: true },
  "package fallback requires canonical row": { packageFallback: true },
  "missing and package fallback stay ordered": { ids: A, missing: true, packageFallback: true },
  "empty requested IDs defer runtime until membership known": { ids: "" },
  "empty membership": { ids: "", empty: true },
  "authorization rejection": { unauthorized: true, explicitId: true },
  "shared rejection": { sharedError: true },
  "runtime rejection": { runtimeError: true },
  "package fallback rejection": { packageFallback: true, fallbackError: true },
})) {
  test(`actual live GET parity with ${BASE.slice(0, 8)}: ${name}`, async () => {
    const before = await execute(BASE, scenario);
    const after = await execute("candidate", scenario);
    assert.deepEqual({ ...after, causalEvents: undefined }, { ...before, causalEvents: undefined },
      "instrumentation must preserve byte response, headers, legacy telemetry and external call arguments/order");
    assert.equal(after.causalEvents.filter((e) => e.kind === "summary").length, 1, "exercise enabled real instrumentation");
    if (after.status === 200) {
      const payload = JSON.parse(after.body).data;
      assert.equal(payload.schema_version, "profiles_live_v1");
      assert.equal(payload.source, "profiles_live_shared_core_v3");
      assert.equal(payload.generated_at, FIXED);
      assert.equal(payload.query_count, after.calls.filter(([name]) => name === "runtime:start").length + 1);
    } else assert.equal(after.status, scenario.unauthorized ? 401 : 500);
  });
}
