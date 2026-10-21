import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_PATH || "typescript");
const backendRoot = fileURLToPath(new URL("../", import.meta.url));
const botappRoot = "/Users/admin/Projects/BotApp-runtime-root-observation-fix-v1";
const referenceBackend = "65aa3ef6a382b7278f0e7cabf51f4d102d43a201";
const referenceBackendTree = "80c360f58d974c3fedb168838912ef14d02d3b7e";
const referenceBotapp = "63551f3a1ea20c2d09affe0beb9ea28b8537ea4d";
const referenceBotappTree = "d4c27dd26db468b45af61607c715e381b2200b6b";
const routePath = "app/api/instagram-dashboard/profiles/live/route.ts";
const accountId = "11111111-1111-4111-8111-111111111111";
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const transportContext = new AsyncLocalStorage();
let logicalRequestSequence = 0;

const { fetchProfilesLiveJsonWithTimeout } = require(path.join(botappRoot, "electron/profiles-live-fetch.cjs"));

function gitSource(root, revision, relative) {
  return execFileSync("git", ["-C", root, "show", `${revision}:${relative}`], { encoding: "utf8" });
}

function loadCommonJs(source, filename, localRequire = require) {
  const loadedModule = { exports: {} };
  const js = filename.endsWith(".ts") ? ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, filename,
  }).outputText : source;
  vm.runInThisContext(`(function(require,module,exports){${js}\n})`, { filename })(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function loadBotappTreeModule(revision, relative) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const source = revision === "candidate" ? readFileSync(path.join(botappRoot, file), "utf8") : gitSource(botappRoot, revision, file);
    const localRequire = (specifier) => {
      if (!specifier.startsWith(".")) return require(specifier);
      let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!path.posix.extname(resolved)) resolved += ".ts";
      return load(resolved);
    };
    const js = file.endsWith(".ts") ? ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText : source;
    vm.runInThisContext(`(function(require,module,exports){${js}\n})`, { filename: `${revision}:${file}` })(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load(relative);
}

const legacyGuard = loadCommonJs(
  gitSource(botappRoot, referenceBotapp, "electron/profiles-response-guard.cjs"),
  `${referenceBotapp}:electron/profiles-response-guard.cjs`,
);
const legacyMerge = loadBotappTreeModule(referenceBotapp, "src/views/profiles/profiles-live-merge.ts");
const candidateMerge = loadBotappTreeModule("candidate", "src/views/profiles/profiles-live-merge.ts");
const referenceRefresh = loadBotappTreeModule(referenceBotapp, "src/views/profiles/profiles-auto-refresh.ts");
const candidateRefresh = loadCommonJs(
  readFileSync(path.join(botappRoot, "src/views/profiles/profiles-auto-refresh.ts"), "utf8"),
  path.join(botappRoot, "src/views/profiles/profiles-auto-refresh.ts"),
);

function baseProfile() {
  return {
    accountId, id: accountId, username: "historical_profile", active: true,
    accountLifecycleStatus: "active", packageLabel: "Pro", package: "pro",
    status: "ready", eligibility: "can_start", readiness: "ready",
    eligibilityDetail: { status: "can_start", primary_block_reason: "", reason_label: "Ready" },
    counters: {
      follow: { current: 5, max: 120 }, unfollow: { current: 4, max: 120 },
      like: { current: 3, max: 500 }, comment: { current: 2, max: 0 }, dm: { current: 1, max: 10 },
    },
  };
}

function runtimeProfile(capsSource = "account_package_summary") {
  return { accountId, capsSource, countersToday: { follows: 6, unfollows: 4, likes: 3, comments: 2, dms: 1 } };
}

function excludedProfile() {
  return { ...baseProfile(), active: false, accountLifecycleStatus: "archived" };
}

function routeModule(revision, io) {
  const cache = new Map();
  const candidate = revision === "candidate";
  const source = (relative) => candidate ? readFileSync(path.join(backendRoot, relative), "utf8")
    : gitSource(backendRoot, revision, relative);
  const context = vm.createContext({
    AbortController, AbortSignal, Buffer, console: { info: () => undefined }, Date, DOMException,
    Headers, performance, process: { env: {} }, Request, Response, setTimeout, clearTimeout, TextEncoder, URL,
  });
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const loadedModule = { exports: {} }; cache.set(relative, loadedModule);
    const localRequire = (specifier) => {
      if (specifier === "node:crypto") return { randomUUID: () => "22222222-2222-4222-8222-222222222222" };
      if (specifier.startsWith("node:")) return require(specifier);
      if (specifier === "@/app/api/instagram-dashboard/_utils") return {
        jsonError: (message, status) => Response.json({ ok: false, error: message }, { status }),
      };
      if (specifier === "@/app/instagram-dashboard/manage-data") return { getManageData: io.getManageData };
      if (relative === routePath && specifier === "../route") return {
        requireProfilesReadAccess: async () => null,
        enrichAccountsWithRuntime: io.enrichAccountsWithRuntime,
      };
      if (specifier === "@/lib/instagram-dashboard/profiles-live-causal") return {
        withProfilesLiveTrace: (_request, _requestId, _correlationId, work) => work(),
        traceStep: (_name, work) => work(), traceMetric: () => undefined,
        traceFallback: (reason) => io.fallbacks.push(reason),
      };
      let resolved = specifier.startsWith("@/") ? specifier.slice(2)
        : path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
      if (!path.posix.extname(resolved)) resolved += ".ts";
      return load(resolved);
    };
    const js = ts.transpileModule(source(relative), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: relative,
    }).outputText;
    vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename: `${revision}:${relative}` })(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load(routePath).GET;
}

async function close(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

function startServer(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => ({ server, origin: `http://127.0.0.1:${server.address().port}` }));
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), connection: "close" });
  response.end(body);
}

async function fixtureEnvironment(subject) {
  let scenario = "success";
  let providerOrigin;
  let closedOrigin;
  const pendingReads = new Set();
  const familyCalls = new Map();
  const fallbacks = [];
  const provider = await startServer((request, response) => {
    const url = new URL(request.url, providerOrigin);
    const family = url.searchParams.get("family");
    const activeScenario = url.searchParams.get("scenario");
    const key = `${activeScenario}:${family}`;
    const call = (familyCalls.get(key) || 0) + 1; familyCalls.set(key, call);
    const payload = family === "manage"
      ? { allAccounts: activeScenario === "empty" ? [excludedProfile()] : [baseProfile()], activeAccounts: activeScenario === "empty" ? [] : [baseProfile()], errors: [] }
      : [runtimeProfile(activeScenario === "fallback" && call === 1 ? "legacy_runtime" : "account_package_summary")];
    if (activeScenario === "reset" && family === "manage") return request.socket.destroy();
    if (activeScenario === "provider-timeout" && family === "manage") return setTimeout(() => sendJson(response, 200, payload), 90);
    if (activeScenario === "headers-delay") return setTimeout(() => sendJson(response, 200, payload), 12);
    if (activeScenario === "body-delay") {
      const body = JSON.stringify(payload); response.writeHead(200, { "content-type": "application/json", connection: "close" });
      response.write(body.slice(0, 2)); return setTimeout(() => response.end(body.slice(2)), 12);
    }
    if (activeScenario === "malformed" && family === "manage") { response.writeHead(200, { "content-type": "application/json" }); return response.end("{malformed"); }
    if (["backend-500", "membership-failure"].includes(activeScenario) && family === "manage") return sendJson(response, 500, { error: "controlled" });
    if (["runtime-failure", "partial"].includes(activeScenario) && family === "runtime") return sendJson(response, 500, { error: "controlled" });
    return sendJson(response, 200, payload);
  });
  providerOrigin = provider.origin;
  const closed = await startServer((_request, response) => response.end());
  closedOrigin = closed.origin;
  await close(closed.server);
  async function read(family, signal) {
    const origin = scenario === "network-failure" && family === "manage" ? closedOrigin : providerOrigin;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await transportContext.run({
        boundary: "BACKEND_REMOTE", operationFamily: family,
        requestId: `${subject}:${activeAttempt?.scenario || scenario}:${family}:${++logicalRequestSequence}`,
        scenario: activeAttempt?.scenario || scenario, subject,
        originClass: origin === closedOrigin ? "unreachable_provider" : "provider",
      }, () => fetch(`${origin}/dependency?family=${family}&scenario=${scenario}&subject=${subject}`, { signal: controller.signal }));
      if (!response.ok) { const error = new Error(`provider HTTP ${response.status}`); error.status = response.status; throw error; }
      const value = await response.json();
      if (family === "manage" && (!value || !Array.isArray(value.allAccounts))) throw new Error("invalid manage payload");
      if (family === "runtime" && !Array.isArray(value)) throw new Error("invalid runtime payload");
      return value;
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
  }
  function trackedRead(family, signal) {
    const pending = read(family, signal);
    pendingReads.add(pending);
    pending.finally(() => pendingReads.delete(pending)).catch(() => undefined);
    return pending;
  }
  return {
    providerOrigin, fallbacks, setScenario(value) { scenario = value; familyCalls.clear(); fallbacks.length = 0; },
    getManageData: (options = {}) => trackedRead("manage", options.signal),
    enrichAccountsWithRuntime: () => trackedRead("runtime"),
    drain: async () => { while (pendingReads.size) await Promise.allSettled([...pendingReads]); },
    close: () => close(provider.server),
  };
}

async function routeServer(get) {
  return startServer(async (request, response) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const result = await get(new Request(`http://127.0.0.1${request.url}`, { headers }));
      const body = Buffer.from(await result.arrayBuffer());
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(body);
    } catch (error) { sendJson(response, 500, { ok: false, error: String(error?.message || error) }); }
  });
}

function unwrapRoutePayload(value) {
  return value && value.ok === true && value.data && typeof value.data === "object" ? value.data : value;
}

function previousModel() {
  return [{ ...baseProfile(), id: accountId, username: "previous_stable", projectionRevision: "2026-09-09T00:00:00.000Z" }];
}

function applyLegacyModel(previous, payload) {
  const data = unwrapRoutePayload(payload);
  const validation = legacyGuard.validateLiveProfilesPayload(data);
  if (!validation.ok) return { accepted: false, model: previous };
  const merged = legacyMerge.mergeProfilesLiveProjection(previous, data.profiles);
  return { accepted: true, model: legacyMerge.applyProfilesMembership(merged, new Map(), data.membership) };
}

const attempts = [];
const attemptByRequest = new WeakMap();
const logicalAttemptCounts = new Map();
const attemptChannels = {
  create: channel("undici:request:create"), headers: channel("undici:request:headers"),
  trailers: channel("undici:request:trailers"), error: channel("undici:request:error"),
};
let activeAttempt = null;
const observeAttempt = ({ request }) => {
  const context = transportContext.getStore();
  if (!context) return;
  const attemptNumber = (logicalAttemptCounts.get(context.requestId) || 0) + 1;
  logicalAttemptCounts.set(context.requestId, attemptNumber);
  const same = attempts.filter((entry) => entry.subject === context.subject && entry.scenario === context.scenario && entry.boundary === context.boundary);
  const record = { boundary: context.boundary, operation_family: context.operationFamily,
    request_id: context.requestId, test_id: context.scenario, request_sequence: same.length + 1,
    attempt_number: attemptNumber, scenario: context.scenario, subject: context.subject,
    origin_class: context.originClass, started_at: new Date().toISOString(), finished_at: null, outcome: null };
  attempts.push(record); attemptByRequest.set(request, record);
};
const observeHeaders = ({ request }) => { const record = attemptByRequest.get(request); if (record) record.headers_at = new Date().toISOString(); };
const finishAttempt = (outcome) => ({ request }) => {
  const record = attemptByRequest.get(request);
  if (record && !record.finished_at) { record.finished_at = new Date().toISOString(); record.outcome = outcome; }
};
const observeTrailers = finishAttempt("response_complete");
const observeError = finishAttempt("transport_error");
attemptChannels.create.subscribe(observeAttempt); attemptChannels.headers.subscribe(observeHeaders);
attemptChannels.trailers.subscribe(observeTrailers); attemptChannels.error.subscribe(observeError);
test.after(() => {
  attemptChannels.create.unsubscribe(observeAttempt); attemptChannels.headers.unsubscribe(observeHeaders);
  attemptChannels.trailers.unsubscribe(observeTrailers); attemptChannels.error.unsubscribe(observeError);
});

async function awaitTerminalAttempts(subject, scenario) {
  for (let index = 0; index < 40; index += 1) {
    const relevant = attempts.filter((entry) => entry.subject === subject && entry.scenario === scenario);
    if (relevant.length && relevant.every((entry) => entry.finished_at)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const pending = attempts.filter((entry) => entry.subject === subject && entry.scenario === scenario && !entry.finished_at);
  assert.deepEqual(pending, [], `in-flight transport attempts: ${subject}:${scenario}`);
}

async function clientRequest(env, route, subject, metricScenario, freshness = false, timeoutMs = 250, fixtureScenario = metricScenario) {
  env.setScenario(fixtureScenario);
  activeAttempt = { providerOrigin: env.providerOrigin, routeOrigin: route.origin, subject, scenario: metricScenario };
  try {
    return await transportContext.run({
      boundary: "BOTAPP_POLL", operationFamily: "profiles_live_poll",
      requestId: `${subject}:${metricScenario}:profiles_live_poll:${++logicalRequestSequence}`,
      scenario: metricScenario, subject, originClass: "backend_route",
    }, () => fetchProfilesLiveJsonWithTimeout(fetch,
      `${route.origin}/api/instagram-dashboard/profiles/live?account_ids=${accountId}`,
      freshness ? { headers: { "X-Profiles-Live-Contract": "freshness-v1" } } : {}, { timeoutMs }));
  } finally {
    await env.drain(); await awaitTerminalAttempts(subject, metricScenario); activeAttempt = null;
  }
}

test("old V2 reaches the actual candidate route across the complete 11-case matrix", async () => {
  const env = await fixtureEnvironment("candidate");
  const route = await routeServer(routeModule("candidate", env));
  const matrix = [
    ["success", true], ["provider-timeout", false], ["network-failure", false], ["reset", false],
    ["headers-delay", true], ["body-delay", true], ["malformed", false], ["backend-500", false],
    ["membership-failure", false], ["runtime-failure", false], ["empty", true],
  ];
  try {
    for (const [scenario, expected] of matrix) {
      const previous = previousModel();
      const result = await clientRequest(env, route, "candidate", `legacy:${scenario}`, false, 250, scenario);
      const payload = unwrapRoutePayload(result.data);
      const applied = applyLegacyModel(previous, result.data);
      assert.equal(applied.accepted, expected, scenario);
      assert.equal(Object.hasOwn(payload || {}, "projection_state"), false, `${scenario}: legacy must not receive freshness state`);
      if (expected) {
        assert.equal(result.response.status, 200, scenario);
        if (scenario !== "empty") assert.equal(payload.profiles[0].username, "historical_profile", `${scenario}: historical route values`);
        if (scenario === "empty") assert.deepEqual(applied.model, [], "confirmed empty membership clears the current Profiles model");
        else assert.equal(Array.isArray(applied.model), true, `${scenario}: actual merge/render model completes`);
      } else {
        assert.equal(result.response.status, 500, scenario);
        assert.strictEqual(applied.model, previous, `${scenario}: previous rendered model preserved`);
      }
    }
    const pollCounts = matrix.map(([scenario]) => attempts.filter((entry) => entry.scenario === `legacy:${scenario}` && entry.boundary === "BOTAPP_POLL").length);
    assert.deepEqual(pollCounts, Array(matrix.length).fill(1), "one transport attempt for every legacy request");
  } finally { await env.drain(); await close(route.server); await env.close(); }
});

async function measuredScenario(subject, revision, label, scenario, freshness) {
  const env = await fixtureEnvironment(subject);
  const route = await routeServer(routeModule(revision, env));
  try {
    const result = await clientRequest(env, route, subject, `traffic:${label}`, freshness, 250, scenario);
    return { status: result.response.status, data: unwrapRoutePayload(result.data), fallbacks: [...env.fallbacks] };
  } finally { await env.drain(); await close(route.server); await env.close(); }
}

async function visibilityScenario(subject, controllerFactory, repeated) {
  const env = await fixtureEnvironment(subject);
  const route = await routeServer(routeModule(subject === "reference" ? referenceBackend : "candidate", env));
  env.setScenario("partial");
  const timers = new Map(); let nextTimer = 0; let firstDone;
  const first = new Promise((resolve) => { firstDone = resolve; });
  activeAttempt = { providerOrigin: env.providerOrigin, routeOrigin: route.origin, subject, scenario: `traffic:${repeated ? "repeated-hide-show" : "visibility-restore"}` };
  const controller = controllerFactory.createProfilesAutoRefreshController({
    isRuntimeActive: () => true,
    setTimeoutFn: (handler, ms) => { const id = ++nextTimer; timers.set(id, { handler, ms }); return id; },
    clearTimeoutFn: (id) => timers.delete(id),
    refresh: async (_reason, context) => {
      const scenario = `traffic:${repeated ? "repeated-hide-show" : "visibility-restore"}`;
      const result = await transportContext.run({
        boundary: "BOTAPP_POLL", operationFamily: "profiles_live_poll",
        requestId: `${subject}:${scenario}:profiles_live_poll:${++logicalRequestSequence}`,
        scenario, subject, originClass: "backend_route",
      }, () => fetchProfilesLiveJsonWithTimeout(fetch,
        `${route.origin}/api/instagram-dashboard/profiles/live?account_ids=${accountId}`,
        subject === "candidate" ? { headers: { "X-Profiles-Live-Contract": "freshness-v1" } } : {}, { timeoutMs: 250 }));
      const data = unwrapRoutePayload(result.data);
      if (subject === "candidate" && data.projection_state === "PARTIAL") context.degraded(); else context.validated();
      firstDone();
    },
  });
  try {
    controller.start(true); await first; await flush();
    const cycles = repeated ? 4 : 1;
    for (let index = 0; index < cycles; index += 1) { controller.handleVisibilityChange(false); controller.handleVisibilityChange(true); await flush(); }
    await new Promise((resolve) => setTimeout(resolve, 80)); await flush();
  } finally {
    controller.stop(); await env.drain();
    await awaitTerminalAttempts(subject, `traffic:${repeated ? "repeated-hide-show" : "visibility-restore"}`);
    activeAttempt = null; await close(route.server); await env.close();
  }
}

test("traffic baseline is dynamically measured against exact Git reference and real candidate branches", async () => {
  const cases = [
    ["success", "success", true], ["provider-deadline", "provider-timeout", true],
    ["network-failure", "network-failure", true], ["connection-reset", "reset", true],
    ["headers-delay", "headers-delay", true],
    ["body-delay", "body-delay", true], ["malformed", "malformed", true],
    ["partial", "partial", true], ["fallback", "fallback", true],
  ];
  const branchResults = {};
  for (const [label, scenario, candidateFreshness] of cases) {
    branchResults[`reference:${label}`] = await measuredScenario("reference", referenceBackend, label, scenario, false);
    branchResults[`candidate:${label}`] = await measuredScenario("candidate", "candidate", label, scenario, candidateFreshness);
  }
  assert.equal(branchResults["candidate:partial"].status, 200);
  assert.equal(branchResults["candidate:partial"].data.projection_state, "PARTIAL");
  assert.equal(legacyGuard.validateLiveProfilesPayload(branchResults["candidate:partial"].data).ok, true);
  const partialModel = candidateMerge.mergeProfilesLiveProjection(previousModel(), branchResults["candidate:partial"].data.profiles.map((profile) => ({
    ...profile, accountId: profile.accountId, canonicalProfile: profile,
    projectionState: branchResults["candidate:partial"].data.projection_state,
    freshness: branchResults["candidate:partial"].data.freshness.profiles[profile.accountId],
    freshnessPolicy: branchResults["candidate:partial"].data.freshness.policy,
  })));
  assert.equal(partialModel[0].runtimeIndicator?.state, "unknown", "real PARTIAL invalidates runtime truth");
  assert.equal(branchResults["candidate:fallback"].data.contract, "freshness-v1");
  assert.equal(branchResults["candidate:fallback"].data.profiles[0].capsSource, "legacy_runtime");
  assert.deepEqual(branchResults["candidate:fallback"].fallbacks, [], "freshness-v1 reprojects acquired runtime data without remote fallback enrichment");
  assert.deepEqual(branchResults["reference:fallback"].fallbacks, ["package_summary_missing"]);

  await visibilityScenario("reference", referenceRefresh, false);
  await visibilityScenario("candidate", candidateRefresh, false);
  await visibilityScenario("reference", referenceRefresh, true);
  await visibilityScenario("candidate", candidateRefresh, true);

  const scenarioNames = [...cases.map(([name]) => name), "visibility-restore", "repeated-hide-show"];
  const rows = scenarioNames.map((scenario) => {
    const count = (subject, boundary) => attempts.filter((entry) => entry.subject === subject && entry.scenario === `traffic:${scenario}` && entry.boundary === boundary).length;
    const referencePoll = count("reference", "BOTAPP_POLL"); const candidatePoll = count("candidate", "BOTAPP_POLL");
    const referenceRemote = count("reference", "BACKEND_REMOTE"); const candidateRemote = count("candidate", "BACKEND_REMOTE");
    return { scenario, reference_botapp_poll_attempts: referencePoll, candidate_botapp_poll_attempts: candidatePoll,
      reference_backend_remote_attempts: referenceRemote, candidate_backend_remote_attempts: candidateRemote,
      remote_amplification: referenceRemote ? candidateRemote / referenceRemote : candidateRemote === 0 ? 0 : Infinity };
  });
  for (const row of rows) {
    assert.ok(row.candidate_botapp_poll_attempts <= row.reference_botapp_poll_attempts, JSON.stringify(row));
    assert.ok(row.candidate_backend_remote_attempts <= row.reference_backend_remote_attempts, JSON.stringify(row));
  }
  const fallback = rows.find((row) => row.scenario === "fallback");
  assert.equal(fallback.reference_backend_remote_attempts, 3);
  assert.equal(fallback.candidate_backend_remote_attempts, 2);
  const visibility = rows.find((row) => row.scenario === "visibility-restore");
  const repeated = rows.find((row) => row.scenario === "repeated-hide-show");
  assert.equal(visibility.candidate_botapp_poll_attempts, 1);
  assert.equal(repeated.candidate_botapp_poll_attempts, 1);
  const referencePollTotal = rows.reduce((sum, row) => sum + row.reference_botapp_poll_attempts, 0);
  const candidatePollTotal = rows.reduce((sum, row) => sum + row.candidate_botapp_poll_attempts, 0);
  const referenceRemoteTotal = rows.reduce((sum, row) => sum + row.reference_backend_remote_attempts, 0);
  const candidateRemoteTotal = rows.reduce((sum, row) => sum + row.candidate_backend_remote_attempts, 0);
  const referenceTotal = referencePollTotal + referenceRemoteTotal;
  const candidateTotal = candidatePollTotal + candidateRemoteTotal;
  const maxAmplification = Math.max(...rows.map((row) => row.remote_amplification));
  const trafficAttempts = attempts.filter((entry) => entry.scenario.startsWith("traffic:"));
  assert.equal(trafficAttempts.filter((entry) => !entry.finished_at).length, 0);
  assert.equal(Math.max(...trafficAttempts.map((entry) => entry.attempt_number)), 1, "no logical request is retried");
  console.log(JSON.stringify({ profiles_live_final_qualification: {
    reference: { backend_sha: referenceBackend, backend_tree: referenceBackendTree, botapp_sha: referenceBotapp, botapp_tree: referenceBotappTree },
    scenarios: rows, reference_botapp_poll_attempts: referencePollTotal, candidate_botapp_poll_attempts: candidatePollTotal,
    reference_backend_remote_attempts: referenceRemoteTotal, candidate_backend_remote_attempts: candidateRemoteTotal,
    reference_total_attempts: referenceTotal, candidate_total_attempts: candidateTotal,
    total_amplification: candidateTotal / referenceTotal, max_scenario_amplification: maxAmplification,
    zero_reference_scenarios: { visibility_restore_immediate_attempts: visibility.candidate_botapp_poll_attempts - 1,
      repeated_hide_show_extra_attempts: repeated.candidate_botapp_poll_attempts - 1 },
    in_flight_attempts_at_count_finalization: trafficAttempts.filter((entry) => !entry.finished_at).length,
    attempt_records: trafficAttempts,
  } }));
});
