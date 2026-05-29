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
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL",
  "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY",
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

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
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

test("searchapi provider returns safe found profile", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "searchapi",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL: "https://searchapi.example.test/api/v1/search",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY: "test-provider-key",
  }, async () => {
    const result = await lookupInstagramPublicProfile("@cinema_catchup", {
      now: fixedNow,
      fetcher: async (url, init) => {
        const requestUrl = new URL(url);
        assert.equal(requestUrl.searchParams.get("engine"), "instagram_profile");
        assert.equal(requestUrl.searchParams.get("username"), "cinema_catchup");
        assert.equal(init.method, "GET");
        assert.equal(init.cache, "no-store");
        return jsonResponse({
          profile: {
            username: "Cinema_Catchup",
            id: "12345",
            avatar: "https://cdn.example.test/avatar.jpg",
            followers: 4321,
            is_private: false,
            is_verified: true,
          },
        });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "found");
    assert.equal(result.canonical_username, "cinema_catchup");
    assert.equal(result.external_profile_id, "12345");
    assert.equal(result.avatar_url, "https://cdn.example.test/avatar.jpg");
    assert.equal(result.followers_count, 4321);
    assert.equal(result.is_private, false);
    assert.equal(result.is_verified, true);
    assert.deepEqual(result.metadata, {
      provider_mode: "searchapi",
      provider_status: "found",
      provider_engine: "instagram_profile",
    });
  });
});

test("searchapi provider maps not_found safely", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "searchapi",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL: "https://searchapi.example.test/api/v1/search",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY: "test-provider-key",
  }, async () => {
    const result = await lookupInstagramPublicProfile("missing_user", {
      now: fixedNow,
      fetcher: async () => jsonResponse({ status: "not_found", reason: "not found" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "not_found");
    assert.equal(result.reason, "not_found");
  });
});

test("searchapi provider maps 429 to rate_limited", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "searchapi",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL: "https://searchapi.example.test/api/v1/search",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY: "test-provider-key",
  }, async () => {
    const result = await lookupInstagramPublicProfile("maybe_user", {
      now: fixedNow,
      fetcher: async () => jsonResponse({ error: "rate limited" }, 429),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "rate_limited");
    assert.equal(result.reason, "rate_limited");
  });
});

test("searchapi provider maps 5xx and timeout to unavailable", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "searchapi",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL: "https://searchapi.example.test/api/v1/search",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY: "test-provider-key",
  }, async () => {
    const serverError = await lookupInstagramPublicProfile("maybe_user", {
      now: fixedNow,
      fetcher: async () => jsonResponse({ error: "temporary" }, 503),
    });
    assert.equal(serverError.status, "unavailable");
    assert.equal(serverError.reason, "provider_unavailable");

    const timeout = await lookupInstagramPublicProfile("maybe_user", {
      now: fixedNow,
      fetcher: async () => {
        const error = new Error("timeout");
        error.name = "AbortError";
        throw error;
      },
    });
    assert.equal(timeout.status, "unavailable");
    assert.equal(timeout.reason, "provider_timeout");
  });
});

test("searchapi provider maps malformed response to provider_error", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "searchapi",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL: "https://searchapi.example.test/api/v1/search",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY: "test-provider-key",
  }, async () => {
    const result = await lookupInstagramPublicProfile("maybe_user", {
      now: fixedNow,
      fetcher: async () => jsonResponse({ profile: { biography: "missing stable lookup fields" } }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, "provider_error");
    assert.equal(result.reason, "provider_invalid_response");
  });
});

test("searchapi provider rejects unsafe avatar URLs", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "searchapi",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL: "https://searchapi.example.test/api/v1/search",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY: "test-provider-key",
  }, async () => {
    const result = await lookupInstagramPublicProfile("cinema_catchup", {
      now: fixedNow,
      fetcher: async () => jsonResponse({
        profile: {
          username: "cinema_catchup",
          profile_pic_url: "https://cdn.example.test/avatar.jpg?token=blocked",
          followers: 1,
        },
      }),
    });

    assert.equal(result.status, "found");
    assert.equal(result.avatar_url, null);
  });
});

test("searchapi provider requires a server API key", async () => {
  await withEnv({
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER: "searchapi",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL: "https://searchapi.example.test/api/v1/search",
    INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY: undefined,
  }, async () => {
    let called = false;
    const result = await lookupInstagramPublicProfile("cinema_catchup", {
      now: fixedNow,
      fetcher: async () => {
        called = true;
        return jsonResponse({});
      },
    });

    assert.equal(called, false);
    assert.equal(result.ok, false);
    assert.equal(result.status, "provider_not_configured");
    assert.equal(result.reason, "provider_not_configured");
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
