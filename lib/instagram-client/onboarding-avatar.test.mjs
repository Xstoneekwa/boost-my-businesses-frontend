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
