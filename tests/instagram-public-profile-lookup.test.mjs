import assert from "node:assert/strict";
import test from "node:test";
import {
  lookupInstagramPublicProfile,
  safeInstagramPublicAvatarUrl,
  safeInstagramPublicMetadata,
} from "../lib/instagram-public-profile-lookup.ts";

const fixedNow = () => new Date("2026-05-29T21:00:00.000Z");
const envKeys = [
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_STATUS",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_CANONICAL_USERNAME",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_INSTAGRAM_USER_ID",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_EXTERNAL_PROFILE_ID",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_AVATAR_URL",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_IS_PRIVATE",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_IS_VERIFIED",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_FOLLOWERS_COUNT",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_REASON",
];

async function withEnv(values, fn) {
  const previous = new Map();
  for (const key of envKeys) previous.set(key, process.env[key]);
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "undefined") delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (typeof value === "undefined") delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("disabled provider returns provider_not_configured", async () => {
  await withEnv({ INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: undefined }, async () => {
    const result = await lookupInstagramPublicProfile("Cinema_Catchup", { now: fixedNow });
    assert.equal(result.ok, false);
    assert.equal(result.status, "provider_not_configured");
    assert.equal(result.input_username, "cinema_catchup");
    assert.equal(result.checked_at, "2026-05-29T21:00:00.000Z");
  });
});

test("mock provider returns safe found profile", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "mock",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_STATUS: "found",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_CANONICAL_USERNAME: "Cinema_Catchup",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_AVATAR_URL: "https://cdn.example.test/avatar.jpg",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_IS_PRIVATE: "true",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_IS_VERIFIED: "true",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_FOLLOWERS_COUNT: "1234",
  }, async () => {
    const result = await lookupInstagramPublicProfile("@cinema_catchup", { now: fixedNow });
    assert.equal(result.ok, true);
    assert.equal(result.status, "found");
    assert.equal(result.canonical_username, "cinema_catchup");
    assert.equal(result.avatar_url, "https://cdn.example.test/avatar.jpg");
    assert.equal(result.is_private, true);
    assert.equal(result.is_verified, true);
    assert.equal(result.followers_count, 1234);
  });
});

test("mock provider returns not_found safely", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "mock",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_STATUS: "not_found",
  }, async () => {
    const result = await lookupInstagramPublicProfile("missing_user", { now: fixedNow });
    assert.equal(result.ok, false);
    assert.equal(result.status, "not_found");
  });
});

test("mock provider returns unavailable safely", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "mock",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_STATUS: "unavailable",
  }, async () => {
    const result = await lookupInstagramPublicProfile("maybe_user", { now: fixedNow });
    assert.equal(result.ok, false);
    assert.equal(result.status, "unavailable");
  });
});

test("invalid username is rejected before provider lookup", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "mock",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_STATUS: "found",
  }, async () => {
    const result = await lookupInstagramPublicProfile(".bad", { now: fixedNow });
    assert.equal(result.ok, false);
    assert.equal(result.status, "username_invalid");
    assert.equal(result.reason, "invalid_format");
  });
});

test("unsafe avatar URLs are rejected", () => {
  assert.equal(safeInstagramPublicAvatarUrl("https://cdn.example.test/a.jpg?token=abc"), null);
  assert.equal(safeInstagramPublicAvatarUrl("file:///tmp/a.jpg"), null);
  assert.equal(safeInstagramPublicAvatarUrl("https://cdn.example.test/a.jpg"), "https://cdn.example.test/a.jpg");
});

test("metadata forbidden keys are rejected", () => {
  const metadata = safeInstagramPublicMetadata({
    provider: "mock",
    token_hint: "blocked",
    raw_html: "blocked",
    followers_bucket: "1k",
  });
  assert.deepEqual(metadata, {
    provider: "mock",
    followers_bucket: "1k",
  });
});
