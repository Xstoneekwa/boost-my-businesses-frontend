import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server.js";
import nextTesting from "next/experimental/testing/server.js";
const { unstable_doesMiddlewareMatch: unstable_doesProxyMatch } = nextTesting;

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const fail = () => { throw new Error("Unmocked external Auth call"); };
function load(path, imports = {}, env = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { module, exports: module.exports, Buffer, Date, URL, process: { env }, require(name) {
    if (!(name in imports)) throw new Error(`Unmocked import: ${name}`);
    return imports[name];
  } });
  return module.exports;
}
const names = { INSTAGRAM_AUTH_ACCESS_COOKIE: "instagram_auth_access_token", INSTAGRAM_AUTH_REFRESH_COOKIE: "instagram_auth_refresh_token" };
const policy = load("session-policy.ts", {}, { NODE_ENV: "production" });
const jwt = (exp, label = "test") => ["fixture", Buffer.from(JSON.stringify({ exp, label })).toString("base64url"), "unsigned"].join(".");
const expired = () => jwt(Date.now() / 1000 - 100);
const fresh = (label) => jwt(Date.now() / 1000 + 3600, label);
function proxyFixture(refresh) {
  return load("../../proxy.ts", {
    "next/server": { NextRequest, NextResponse },
    "@/lib/instagram-auth/refresh-session": { refreshInstagramAuthSession: refresh },
    "@/lib/instagram-auth/session-policy": policy,
    "@/lib/userContext": names,
  });
}
function request(path = "/instagram-dashboard/commercial", access = expired(), refresh = "fixture-refresh") {
  return new NextRequest(`https://preview.example.test${path}`, { headers: { cookie: `${names.INSTAGRAM_AUTH_ACCESS_COOKIE}=${access}; ${names.INSTAGRAM_AUTH_REFRESH_COOKIE}=${refresh}; restaurant_auth_access_token=restaurant-unchanged` } });
}
function resolverFixture({ accessToken = "", refreshToken = "", validAccess = "valid", role = "superadmin", authError = null } = {}) {
  const cookies = { accessToken, refreshToken }; const actions = [];
  const session = { accessToken: "rotated", refreshToken: "rotated-refresh", userId: "fixture-user" };
  const guard = load("resolve-user-context.ts", {
    "@/lib/supabase/admin": { createSupabaseAdminClient: () => ({ auth: { async getUser(token) {
      return { data: { user: token === validAccess ? { id: "fixture-user" } : null }, error: authError };
    } }, from(table) {
      assert.equal(table, "tenant_users");
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { user_id: "fixture-user", tenant_id: "fixture-tenant", role }, error: null }; } };
    } }) },
    "@/lib/userContext": { isUserRole: (r) => ["superadmin", "tenant"].includes(r), createUserContextFromTenantUser: (r) => ({ userId: r.user_id, role: r.role, tenantId: r.tenant_id }) },
    "@/lib/instagram-auth/cookies": {
      readInstagramAuthCookies: async () => cookies,
      writeInstagramAuthCookies: async (a, r) => { actions.push("write"); cookies.accessToken = a; cookies.refreshToken = r; },
      clearInstagramAuthCookies: async () => { actions.push("clear"); cookies.accessToken = ""; cookies.refreshToken = ""; },
    },
    "@/lib/instagram-auth/refresh-session": { refreshInstagramAuthSession: async () => { actions.push("refresh"); return session; }, throwIfInstagramAuthUnavailable: (e) => { if (e && (!e.status || e.status >= 500 || e.status === 429)) throw new Error("Auth unavailable"); } },
  });
  return { guard, cookies, actions };
}

test("cookie lifetime, HttpOnly, Secure, SameSite and host-only scope are unchanged", () => {
  const p = policy.getInstagramAuthCookieOptions();
  assert.equal(p.maxAge, 7 * 24 * 3600); assert.equal(p.httpOnly, true); assert.equal(p.secure, true);
  assert.equal(p.sameSite, "lax"); assert.equal(p.path, "/"); assert.equal(p.domain, undefined);
});
for (const token of ["", "not-a-token", "a.!.c", jwt(null), expired(), jwt(Date.now() / 1000 + 30)]) {
  test(`missing/malformed/expiring access requests a persisted refresh (${token.length} characters)`, () => assert.equal(policy.instagramAccessNeedsRefresh(token), true));
}
test("fresh expiry is a scheduling hint, not verified authorization", () => assert.equal(policy.instagramAccessNeedsRefresh(fresh()), false));

test("controlled expiry refreshes once and forwards BOTH cookies to this render and browser", async () => {
  let calls = 0; const pair = { accessToken: fresh("rotated"), refreshToken: "fixture-rotated", userId: "fixture-user" };
  const { proxy } = proxyFixture(async () => { calls++; return pair; });
  const req = request(); const res = await proxy(req);
  assert.equal(calls, 1); assert.equal(req.cookies.get(names.INSTAGRAM_AUTH_ACCESS_COOKIE).value, pair.accessToken);
  assert.equal(req.cookies.get(names.INSTAGRAM_AUTH_REFRESH_COOKIE).value, pair.refreshToken);
  for (const name of Object.values(names)) {
    assert.equal(res.cookies.get(name).httpOnly, true); assert.equal(res.cookies.get(name).secure, true);
    assert.equal(res.cookies.get(name).maxAge, 604800);
  }
  assert.equal(res.cookies.get(names.INSTAGRAM_AUTH_REFRESH_COOKIE).value, pair.refreshToken);
  assert.match(res.headers.get("x-middleware-request-cookie"), /fixture-rotated/);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal(req.cookies.get("restaurant_auth_access_token").value, "restaurant-unchanged");
  assert.equal(res.cookies.get("restaurant_auth_access_token"), undefined);
  assert.equal(await res.text(), "");
});
test("refresh x3, navigation x3 and tab restoration reuse the persisted fresh pair without another refresh", async () => {
  let calls = 0; const pair = { accessToken: fresh("restored"), refreshToken: "fixture-restored", userId: "fixture-user" };
  const { proxy } = proxyFixture(async () => { calls++; return pair; });
  const first = await proxy(request());
  const a = first.cookies.get(names.INSTAGRAM_AUTH_ACCESS_COOKIE).value;
  const r = first.cookies.get(names.INSTAGRAM_AUTH_REFRESH_COOKIE).value;
  for (const path of Array(3).fill("/instagram-dashboard/commercial").concat(Array(3).fill(["/instagram-dashboard", "/instagram-dashboard/commercial"]).flat(), ["/instagram-dashboard/commercial"])) {
    const res = await proxy(request(path, a, r)); assert.equal(res.status, 200);
  }
  assert.equal(calls, 1);
});
test("two tabs with a simultaneous expiry persist the same provider-approved rotated pair", async () => {
  const pair = { accessToken: fresh("shared"), refreshToken: "fixture-shared", userId: "fixture-user" };
  const { proxy } = proxyFixture(async () => pair);
  const responses = await Promise.all([proxy(request()), proxy(request())]);
  assert.equal(responses[0].cookies.get(names.INSTAGRAM_AUTH_REFRESH_COOKIE).value, responses[1].cookies.get(names.INSTAGRAM_AUTH_REFRESH_COOKIE).value);
});
test("concurrent users never share a cached client or token pair", async () => {
  const { proxy } = proxyFixture(async (r) => ({ accessToken: fresh(r), refreshToken: `${r}-rotated`, userId: r }));
  const [a, b] = await Promise.all([proxy(request(undefined, expired(), "user-a")), proxy(request(undefined, expired(), "user-b"))]);
  assert.equal(a.cookies.get(names.INSTAGRAM_AUTH_REFRESH_COOKIE).value, "user-a-rotated");
  assert.equal(b.cookies.get(names.INSTAGRAM_AUTH_REFRESH_COOKIE).value, "user-b-rotated");
});
test("invalid/revoked refresh fails closed as JSON 401 for APIs, not a login HTML redirect", async () => {
  const { proxy } = proxyFixture(async () => null);
  const res = await proxy(request("/api/instagram-dashboard/commercial/discovery/runs"));
  assert.equal(res.status, 401); assert.match(res.headers.get("content-type"), /application\/json/);
  assert.equal(res.cookies.get(names.INSTAGRAM_AUTH_REFRESH_COOKIE).maxAge, 0);
  assert.equal(res.headers.get("location"), null);
});
test("invalid refresh redirects a page to login without accepting external return URLs", async () => {
  const { proxy } = proxyFixture(async () => null); const res = await proxy(request());
  assert.equal(res.headers.get("location"), "https://preview.example.test/instagram-login");
});
test("invalid refresh on login clears cookies without a redirect loop", async () => {
  const { proxy } = proxyFixture(async () => null); const res = await proxy(request("/instagram-login"));
  assert.equal(res.status, 200); assert.equal(res.headers.get("location"), null);
});
test("temporary Auth failure returns 503 but does not destroy cookies or reveal provider errors", async () => {
  const { proxy } = proxyFixture(async () => { throw new Error("private diagnostic must not escape"); });
  const res = await proxy(request()); assert.equal(res.status, 503); assert.equal(res.cookies.getAll().length, 0);
  assert.doesNotMatch(await res.text(), /private diagnostic|fixture-refresh/);
});
test("read-only guards never consume a refresh token they cannot persist", async () => {
  const f = resolverFixture({ accessToken: "expired", refreshToken: "fixture-refresh" });
  assert.equal(await f.guard.resolveInstagramUserContextFromCookies(), null); assert.equal(f.actions.length, 0);
});
test("route-handler fallback refresh persists the rotated pair before returning context", async () => {
  const f = resolverFixture({ accessToken: "expired", refreshToken: "fixture-refresh" });
  const ctx = await f.guard.resolveInstagramUserContextFromCookies({ allowCookieMutation: true });
  assert.equal(ctx.userId, "fixture-user"); assert.deepEqual(f.actions, ["refresh", "write"]); assert.equal(f.cookies.refreshToken, "rotated-refresh");
});
test("forged fresh exp never grants authentication or owner access", async () => {
  const f = resolverFixture({ accessToken: fresh("forged"), refreshToken: "" });
  assert.equal(await f.guard.resolveInstagramUserContextFromCookies(), null);
});
test("anonymous session remains unauthenticated without provider calls", async () => {
  const f = resolverFixture(); assert.equal(await f.guard.resolveInstagramUserContextFromCookies(), null); assert.equal(f.actions.length, 0);
  const { proxy } = proxyFixture(fail); const res = await proxy(new NextRequest("https://preview.example.test/instagram-dashboard"));
  assert.equal(res.headers.get("x-middleware-next"), "1"); // downstream guard, not proxy, authorizes
});
test("temporary getUser outage fails closed without treating it as a real logout", async () => {
  const f = resolverFixture({ accessToken: "valid", refreshToken: "fixture-refresh", authError: { status: 503 } });
  await assert.rejects(f.guard.resolveInstagramUserContextFromCookies(), /Auth unavailable/); assert.equal(f.actions.length, 0);
});
for (const status of [0, 429, 500, 503]) {
  test(`Auth refresh ${status} preserves the session and fails closed`, async () => {
    const module = load("refresh-session.ts", { "@/lib/supabase/admin": { createSupabaseAdminClient: () => ({ auth: { refreshSession: async () => ({ data: {}, error: { status } }) } }) } });
    await assert.rejects(module.refreshInstagramAuthSession("fixture-refresh"), /temporarily unavailable/);
  });
}
test("Auth refresh 400 invalid token is a definitive refusal", async () => {
  const module = load("refresh-session.ts", { "@/lib/supabase/admin": { createSupabaseAdminClient: () => ({ auth: { refreshSession: async () => ({ data: {}, error: { status: 400 } }) } }) } });
  assert.equal(await module.refreshInstagramAuthSession("fixture-refresh"), null);
});
test("Instagram sign-in does not start a localStorage/BroadcastChannel/LockManager token owner; restaurant client unchanged", () => {
  const options = [];
  const browser = load("../supabase/browser.ts", { "@supabase/supabase-js": { createClient: (...args) => { options.push(args[2]); return {}; } } }, { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "not-a-key" });
  browser.createSupabaseBrowserClient(); browser.createInstagramSignInClient();
  assert.equal(options[0], undefined);
  assert.equal(options[1].auth.persistSession, false); assert.equal(options[1].auth.autoRefreshToken, false); assert.equal(options[1].auth.detectSessionInUrl, false);
});
test("proxy is scoped to Instagram auth/dashboard and never restaurant, webhooks or cron", () => {
  const { config } = proxyFixture(fail);
  for (const url of ["/instagram-login", "/instagram-dashboard", "/instagram-dashboard/commercial", "/instagram-client", "/api/instagram-dashboard/commercial/discovery/runs"]) assert.equal(unstable_doesProxyMatch({ config, nextConfig: {}, url }), true);
  for (const url of ["/api/instagram-auth/session", "/api/cron/test", "/api/restaurant-auth/session", "/restaurant-login", "/restaurant-analytics/overview", "/_next/static/test.js", "/api/webhooks/test"]) assert.equal(unstable_doesProxyMatch({ config, nextConfig: {}, url }), false);
});
test("explicit logout clears both cookies; following restore is unauthorized, never automatic credentials", async () => {
  const f = resolverFixture({ accessToken: "valid", refreshToken: "fixture-refresh" });
  const route = load("../../app/api/instagram-auth/session/route.ts", {
    "next/server": { NextResponse }, "@/lib/supabase/admin": { createSupabaseAdminClient: fail },
    "@/lib/instagram-auth/cookies": { clearInstagramAuthCookies: async () => { f.cookies.accessToken = ""; f.cookies.refreshToken = ""; }, writeInstagramAuthCookies: fail },
    "@/lib/instagram-auth/resolve-user-context": { refreshInstagramUserContextFromCookies: () => f.guard.refreshInstagramUserContextFromCookies() },
    "@/lib/userContext": {},
  });
  assert.equal((await route.DELETE()).status, 200); assert.equal((await route.GET()).status, 401); assert.equal(f.actions.length, 0);
});
test("session restore returns safe JSON 503 on outage, not HTML or cookie deletion", async () => {
  const route = load("../../app/api/instagram-auth/session/route.ts", {
    "next/server": { NextResponse }, "@/lib/supabase/admin": { createSupabaseAdminClient: fail },
    "@/lib/instagram-auth/cookies": { clearInstagramAuthCookies: fail, writeInstagramAuthCookies: fail },
    "@/lib/instagram-auth/resolve-user-context": { refreshInstagramUserContextFromCookies: async () => { throw new Error("must not escape"); } },
    "@/lib/userContext": {},
  });
  const res = await route.GET(); assert.equal(res.status, 503); assert.equal(res.cookies.getAll().length, 0);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store"); assert.doesNotMatch(await res.text(), /must not escape/);
});
for (const [authenticated, role, grantLookupSucceeded, hasActiveGrant, status] of [
  [false, null, true, false, 401], [true, "tenant", true, true, 403],
  [true, "superadmin", true, false, 403], [true, "superadmin", false, true, 503],
  [true, "superadmin", true, true, undefined],
]) {
  test(`existing owner-only policy remains fail-closed (${role}, grant=${hasActiveGrant}, status=${status ?? 200})`, () => {
    const { evaluateCommercialCrmAccess } = load("../commercial/crm-access-policy.ts");
    const result = evaluateCommercialCrmAccess({ authenticated, role, grantLookupSucceeded, hasActiveGrant });
    assert.equal(result.status, status); assert.equal(result.allowed, status === undefined);
  });
}
test("Commercial owner DB-grant policy remains authoritative, with no new auth bypass", () => {
  const source = read("../commercial/crm-access.ts");
  assert.match(source, /internal_access_grants/); assert.match(source, /hasActiveGrant/); assert.match(source, /getInstagramUserContextReadOnly/);
  assert.doesNotMatch(read("../../proxy.ts"), /internal_access_grants|superadmin|Authorization|console\./);
  assert.doesNotMatch(read("../../app/instagram-login/InstagramLoginClient.tsx"), /localStorage|onAuthStateChange|router\.push/);
  assert.match(read("../../app/instagram-login/page.tsx"), /getInstagramUserContextReadOnly/);
});
