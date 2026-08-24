import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("avatar proxy reads only persisted safe avatar fields", () => {
  assert.match(source, /from\("ig_accounts"\)/);
  assert.match(source, /from\("ig_targets"\)/);
  assert.match(source, /select\("avatar_url"\)/);
  assert.match(source, /select\("avatar_url,normalized_username,target_username"\)/);
  assert.doesNotMatch(source, /password/);
  assert.doesNotMatch(source, /secret_ref/);
});

test("avatar proxy fetches server-side and returns image content only", () => {
  assert.match(source, /fetch\(avatarUrl/);
  assert.match(source, /resolveTargetAvatarUpstream/);
  assert.match(source, /allowedImageTypes/);
  assert.match(source, /Content-Type/);
  assert.match(source, /Cache-Control/);
});

test("target avatars use graceful fallback while account avatar behavior remains unchanged", () => {
  assert.match(source, /if \(kind === "target"\)/);
  assert.match(source, /negativeCacheTtlMs: TARGET_AVATAR_NEGATIVE_CACHE_TTL_MS/);
  assert.match(source, /status: 404/);
  assert.match(source, /if \(!upstream\.ok\) return jsonError\("avatar_unavailable", 502\)/);
  assert.match(source, /catch \{\s*return jsonError\("avatar_unavailable", 502\)/);
});

test("target telemetry is structured and never logs the signed avatar URL", () => {
  const loggerBody = source.match(/function logTargetAvatarResolution[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(loggerBody, /kind: "target"/);
  assert.match(loggerBody, /target_id_hash/);
  assert.match(loggerBody, /upstream_hostname/);
  assert.match(loggerBody, /upstream_status/);
  assert.match(loggerBody, /refresh_attempted/);
  assert.match(loggerBody, /refresh_result/);
  assert.match(loggerBody, /fallback_used/);
  assert.doesNotMatch(loggerBody, /source\.storedAvatarUrl|resolvedAvatarUrl|searchParams|username/);
});
