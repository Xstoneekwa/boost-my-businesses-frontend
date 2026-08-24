import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resetTargetAvatarProxyCacheForTests,
  resolveTargetAvatarUpstream,
  targetAvatarMaxBytes,
} from "./target-avatar-proxy-server.ts";

function imageResponse(body = new Uint8Array([1, 2, 3]), init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      "content-type": init.contentType ?? "image/jpeg",
      ...(init.contentLength ? { "content-length": String(init.contentLength) } : {}),
    },
  });
}

function lookupResult(status, avatarUrl = null) {
  return {
    ok: status === "found",
    status,
    input_username: "avatar_test",
    canonical_username: status === "found" ? "avatar_test" : null,
    instagram_user_id: null,
    external_profile_id: null,
    avatar_url: avatarUrl,
    is_private: null,
    is_verified: null,
    followers_count: null,
    reason: status,
    checked_at: "2026-08-24T00:00:00.000Z",
    metadata: {},
  };
}

test.beforeEach(() => resetTargetAvatarProxyCacheForTests());

test("onboarding avatar proxy accepts a bounded valid image", async () => {
  const result = await resolveTargetAvatarUpstream({
    username: "avatar_test",
    storedAvatarUrl: "https://cdn.example.test/avatar.jpg",
    allowProviderRefresh: false,
  }, { fetcher: async () => imageResponse() });
  assert.equal(result?.contentType, "image/jpeg");
  assert.deepEqual([...result.body], [1, 2, 3]);
});

test("onboarding avatar proxy rejects 403, wrong content type, timeout and oversized images", async () => {
  const input = { username: "avatar_test", storedAvatarUrl: "https://cdn.example.test/avatar.jpg", allowProviderRefresh: false };
  assert.equal(await resolveTargetAvatarUpstream(input, { fetcher: async () => imageResponse(undefined, { status: 403 }) }), null);
  assert.equal(await resolveTargetAvatarUpstream(input, { fetcher: async () => imageResponse(undefined, { contentType: "text/html" }) }), null);
  assert.equal(await resolveTargetAvatarUpstream(input, { fetcher: async () => { throw new DOMException("timeout", "AbortError"); } }), null);
  assert.equal(await resolveTargetAvatarUpstream(input, { fetcher: async () => imageResponse(undefined, { contentLength: targetAvatarMaxBytes + 1 }) }), null);
  assert.equal(await resolveTargetAvatarUpstream(input, { fetcher: async () => imageResponse(new Uint8Array(targetAvatarMaxBytes + 1)) }), null);
});

test("dashboard target flow observes a persisted 403 and attempts exactly one provider refresh", async () => {
  let fetchCalls = 0;
  let lookupCalls = 0;
  const events = [];
  const result = await resolveTargetAvatarUpstream({
    username: "avatar_test",
    storedAvatarUrl: "https://scontent-cdg4-3.cdninstagram.com/avatar.jpg?oe=expired",
    negativeCacheTtlMs: 60_000,
  }, {
    fetcher: async () => { fetchCalls += 1; return imageResponse(undefined, { status: 403 }); },
    lookup: async () => { lookupCalls += 1; return lookupResult("unavailable"); },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result, null);
  assert.equal(fetchCalls, 1);
  assert.equal(lookupCalls, 1);
  assert.deepEqual(events.find((event) => event.type === "upstream_fetch"), {
    type: "upstream_fetch",
    source: "stored",
    hostname: "scontent-cdg4-3.cdninstagram.com",
    status: 403,
    result: "http_error",
  });
  assert.equal(events.some((event) => event.type === "provider_refresh" && event.result === "unavailable"), true);
});

test("dashboard target flow returns refreshed image bytes after a persisted 403", async () => {
  const expiredUrl = "https://scontent-cdg4-3.cdninstagram.com/expired.jpg?oe=expired";
  const freshUrl = "https://scontent-cdg4-3.cdninstagram.com/fresh.jpg?oe=future";
  const fetchedUrls = [];
  const result = await resolveTargetAvatarUpstream({
    username: "avatar_test",
    storedAvatarUrl: expiredUrl,
    negativeCacheTtlMs: 60_000,
  }, {
    fetcher: async (url) => {
      fetchedUrls.push(String(url));
      return String(url) === freshUrl ? imageResponse(new Uint8Array([9, 8, 7])) : imageResponse(undefined, { status: 403 });
    },
    lookup: async () => lookupResult("found", freshUrl),
  });
  assert.equal(result?.refreshedFromProvider, true);
  assert.deepEqual([...result.body], [9, 8, 7]);
  assert.deepEqual(fetchedUrls, [expiredUrl, freshUrl]);
});

test("failed target resolution enters a short negative cache and suppresses an upstream storm", async () => {
  let nowMs = 10_000;
  let fetchCalls = 0;
  let lookupCalls = 0;
  const input = {
    username: "avatar_test",
    storedAvatarUrl: "https://scontent-cdg4-3.cdninstagram.com/expired.jpg?oe=expired",
    negativeCacheTtlMs: 60_000,
  };
  const dependencies = {
    now: () => nowMs,
    fetcher: async () => { fetchCalls += 1; return imageResponse(undefined, { status: 403 }); },
    lookup: async () => { lookupCalls += 1; return lookupResult("unavailable"); },
  };
  assert.equal(await resolveTargetAvatarUpstream(input, dependencies), null);

  const repeatedEvents = [];
  assert.equal(await resolveTargetAvatarUpstream(input, {
    ...dependencies,
    onEvent: (event) => repeatedEvents.push(event),
  }), null);
  assert.equal(fetchCalls, 1);
  assert.equal(lookupCalls, 1);
  assert.deepEqual(repeatedEvents, [{ type: "negative_cache", result: "hit" }]);

  nowMs += 60_001;
  assert.equal(await resolveTargetAvatarUpstream(input, dependencies), null);
  assert.equal(fetchCalls, 2);
  assert.equal(lookupCalls, 2);
});

test("invalid MIME and oversized target responses fall back without a server error", async () => {
  const inputs = [
    async () => imageResponse(undefined, { contentType: "text/html" }),
    async () => imageResponse(undefined, { contentLength: targetAvatarMaxBytes + 1 }),
    async () => imageResponse(new Uint8Array(targetAvatarMaxBytes + 1)),
  ];
  for (const [index, fetcher] of inputs.entries()) {
    const result = await resolveTargetAvatarUpstream({
      username: `avatar_test_${index}`,
      storedAvatarUrl: `https://scontent-cdg4-3.cdninstagram.com/avatar-${index}.jpg?oe=expired`,
      allowProviderRefresh: false,
      negativeCacheTtlMs: 60_000,
    }, { fetcher });
    assert.equal(result, null);
    const fallbackStatus = result ? 200 : 404;
    assert.equal(fallbackStatus < 500, true);
  }
});

test("Loriele field replay maps 30 expired target loads to non-5xx and coalesces repeats", async () => {
  let fetchCalls = 0;
  let lookupCalls = 0;
  const statuses = [];
  const targets = Array.from({ length: 15 }, (_, index) => ({
    username: `loriele_expired_${index + 1}`,
    storedAvatarUrl: `https://scontent-cdg4-3.cdninstagram.com/loriele-${index + 1}.jpg?oe=expired`,
    negativeCacheTtlMs: 60_000,
  }));
  const dependencies = {
    fetcher: async () => { fetchCalls += 1; return imageResponse(undefined, { status: 403 }); },
    lookup: async () => { lookupCalls += 1; return lookupResult("unavailable"); },
  };
  for (let pass = 0; pass < 2; pass += 1) {
    for (const target of targets) {
      const result = await resolveTargetAvatarUpstream(target, dependencies);
      statuses.push(result ? 200 : 404);
    }
  }
  assert.equal(statuses.length, 30);
  assert.equal(statuses.filter((status) => status >= 500).length, 0);
  assert.equal(statuses.filter((status) => status === 404).length, 30);
  assert.equal(fetchCalls, 15);
  assert.equal(lookupCalls, 15);
});

test("avatar rendering never triggers a profile lookup when refresh is not an explicit reanalysis", async () => {
  let lookupCalls = 0;
  const result = await resolveTargetAvatarUpstream({
    username: "avatar_test",
    storedAvatarUrl: "https://cdn.example.test/expired.jpg",
    allowProviderRefresh: false,
  }, {
    fetcher: async () => imageResponse(undefined, { status: 403 }),
    lookup: async () => { lookupCalls += 1; throw new Error("must_not_run"); },
  });
  assert.equal(result, null);
  assert.equal(lookupCalls, 0);
});

test("account-scoped onboarding avatar route authenticates ownership and emits only image bytes", () => {
  const route = readFileSync(new URL("../../app/api/instagram-client/onboarding/avatar/route.ts", import.meta.url), "utf8");
  const wizard = readFileSync(new URL("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx", import.meta.url), "utf8");
  assert.match(route, /requireClientInstagramSession/);
  assert.match(route, /loadClientOnboardingAvatarSource\(session\.clientId, sessionId\)/);
  assert.match(route, /allowProviderRefresh: false/);
  assert.doesNotMatch(route, /searchParams\.get\("url"\)|avatar_url|api_key/i);
  assert.match(route, /X-Content-Type-Options/);
  assert.match(wizard, /onError=\{\(\) => setAvatarFailed\(true\)\}/);
  assert.match(wizard, /\/api\/instagram-client\/onboarding\/avatar\?session_id=/);
  assert.doesNotMatch(wizard, /analysis\.avatarUrl/);
});
