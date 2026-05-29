export type InstagramPublicProfileLookupStatus =
  | "found"
  | "not_found"
  | "username_invalid"
  | "unavailable"
  | "rate_limited"
  | "provider_not_configured"
  | "provider_error";

export type InstagramPublicProfileLookupResult = {
  ok: boolean;
  status: InstagramPublicProfileLookupStatus;
  input_username: string;
  canonical_username: string | null;
  instagram_user_id: string | null;
  external_profile_id: string | null;
  avatar_url: string | null;
  is_private: boolean | null;
  is_verified: boolean | null;
  followers_count: number | null;
  reason: string;
  checked_at: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type InstagramPublicProfileLookupOptions = {
  provider?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
  disableCache?: boolean;
};

const instagramUsernamePattern = /^[a-z0-9._]{1,30}$/;
const safeReasonPattern = /[^a-z0-9_:-]/g;
const forbiddenMetadataFragments = [
  "password",
  "secret",
  "token",
  "authorization",
  "cookie",
  "session",
  "service_role",
  "vault",
  "raw",
  "html",
  "header",
  "ip",
];
const unsafeUrlFragments = [
  "token",
  "secret",
  "signature",
  "x-amz",
  "authorization",
  "service_role",
  "supabase_vault://",
];
const defaultSearchApiFoundTtlSeconds = 86400;
const defaultSearchApiNotFoundTtlSeconds = 3600;
const defaultSearchApiErrorTtlSeconds = 600;
const defaultSearchApiMinIntervalMs = 1000;
const defaultSearchApiMaxPerMinute = 20;
const searchApiCache = new Map<string, { result: InstagramPublicProfileLookupResult; expiresAtMs: number }>();
let searchApiCallTimestampsMs: number[] = [];
let searchApiLastCallAtMs = 0;
let searchApiQueue: Promise<void> = Promise.resolve();

function safeNow(options: InstagramPublicProfileLookupOptions) {
  return (options.now?.() ?? new Date()).toISOString();
}

function safeNowMs(options: InstagramPublicProfileLookupOptions) {
  return (options.now?.() ?? new Date()).getTime();
}

function readNonNegativeIntegerEnv(key: string, fallback: number) {
  const value = process.env[key]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function searchApiCacheTtlSeconds(status: InstagramPublicProfileLookupStatus) {
  if (status === "found") {
    return readNonNegativeIntegerEnv(
      "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_CACHE_TTL_FOUND_SECONDS",
      defaultSearchApiFoundTtlSeconds,
    );
  }
  if (status === "not_found") {
    return readNonNegativeIntegerEnv(
      "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_CACHE_TTL_NOT_FOUND_SECONDS",
      defaultSearchApiNotFoundTtlSeconds,
    );
  }
  if (status === "rate_limited" || status === "unavailable" || status === "provider_error") {
    return readNonNegativeIntegerEnv(
      "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_CACHE_TTL_ERROR_SECONDS",
      defaultSearchApiErrorTtlSeconds,
    );
  }
  return 0;
}

function withLookupMetadata(
  lookup: InstagramPublicProfileLookupResult,
  metadata: Record<string, string | number | boolean | null>,
) {
  return {
    ...lookup,
    metadata: safeInstagramPublicMetadata({
      ...lookup.metadata,
      ...metadata,
    }),
  };
}

function searchApiCacheKey(inputUsername: string) {
  return `searchapi:${inputUsername}`;
}

function readSearchApiCache(inputUsername: string, options: InstagramPublicProfileLookupOptions) {
  if (options.disableCache) return null;
  const cached = searchApiCache.get(searchApiCacheKey(inputUsername));
  const nowMs = safeNowMs(options);
  if (!cached || cached.expiresAtMs <= nowMs) {
    if (cached) searchApiCache.delete(searchApiCacheKey(inputUsername));
    return null;
  }
  return withLookupMetadata(cached.result, {
    cache_hit: true,
    throttle_hit: false,
    rate_limited: cached.result.status === "rate_limited",
  });
}

function writeSearchApiCache(inputUsername: string, lookup: InstagramPublicProfileLookupResult, options: InstagramPublicProfileLookupOptions) {
  if (options.disableCache) return;
  const ttlSeconds = searchApiCacheTtlSeconds(lookup.status);
  if (ttlSeconds <= 0) return;
  searchApiCache.set(searchApiCacheKey(inputUsername), {
    result: lookup,
    expiresAtMs: safeNowMs(options) + ttlSeconds * 1000,
  });
}

function searchApiThrottleResult(inputUsername: string, options: InstagramPublicProfileLookupOptions) {
  return result(inputUsername, "rate_limited", options, {
    reason: "provider_throttled",
    metadata: {
      provider_mode: "searchapi",
      provider_status: "rate_limited",
      cache_hit: false,
      throttle_hit: true,
      rate_limited: true,
    },
  });
}

function checkSearchApiThrottle(inputUsername: string, options: InstagramPublicProfileLookupOptions) {
  const nowMs = safeNowMs(options);
  const minIntervalMs = readNonNegativeIntegerEnv(
    "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MIN_INTERVAL_MS",
    defaultSearchApiMinIntervalMs,
  );
  const maxPerMinute = readNonNegativeIntegerEnv(
    "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MAX_PER_MINUTE",
    defaultSearchApiMaxPerMinute,
  );
  searchApiCallTimestampsMs = searchApiCallTimestampsMs.filter((timestamp) => nowMs - timestamp < 60000);
  if (maxPerMinute > 0 && searchApiCallTimestampsMs.length >= maxPerMinute) {
    return searchApiThrottleResult(inputUsername, options);
  }
  if (minIntervalMs > 0 && searchApiLastCallAtMs > 0 && nowMs - searchApiLastCallAtMs < minIntervalMs) {
    return searchApiThrottleResult(inputUsername, options);
  }
  searchApiCallTimestampsMs.push(nowMs);
  searchApiLastCallAtMs = nowMs;
  return null;
}

async function runSearchApiSerialized<T>(operation: () => Promise<T>) {
  const previous = searchApiQueue.catch(() => undefined);
  let release = () => {};
  searchApiQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export function resetInstagramPublicProfileLookupGuardsForTests() {
  searchApiCache.clear();
  searchApiCallTimestampsMs = [];
  searchApiLastCallAtMs = 0;
  searchApiQueue = Promise.resolve();
}

export function normalizeInstagramPublicUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function isPlausibleInstagramPublicUsername(username: string) {
  return (
    instagramUsernamePattern.test(username) &&
    !username.includes("..") &&
    !username.startsWith(".") &&
    !username.endsWith(".")
  );
}

function safeReason(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  return value.trim().toLowerCase().replace(safeReasonPattern, "_").slice(0, 120) || fallback;
}

export function safeInstagramPublicAvatarUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (value.length > 2048) return null;

  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const unsafeText = `${url.username} ${url.password} ${url.search} ${url.hash}`.toLowerCase();
    if (unsafeUrlFragments.some((fragment) => unsafeText.includes(fragment))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function safeInstagramPublicMetadata(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const safe: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey || forbiddenMetadataFragments.some((fragment) => normalizedKey.includes(fragment))) {
      continue;
    }
    if (typeof value === "string") {
      safe[normalizedKey] = value.trim().slice(0, 160);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[normalizedKey] = value;
    } else if (typeof value === "boolean" || value === null) {
      safe[normalizedKey] = value;
    }
    if (Object.keys(safe).length >= 12) break;
  }

  return safe;
}

function readString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readBoolean(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function readRecord(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return null;
}

function readMockBoolean(value: string | undefined) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function readFollowersCount(row: Record<string, unknown>) {
  const value = row.followers_count ?? row.followers;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function result(
  inputUsername: string,
  status: InstagramPublicProfileLookupStatus,
  options: InstagramPublicProfileLookupOptions,
  patch: Partial<InstagramPublicProfileLookupResult> = {},
): InstagramPublicProfileLookupResult {
  return {
    ok: status === "found",
    status,
    input_username: inputUsername,
    canonical_username: patch.canonical_username ?? null,
    instagram_user_id: patch.instagram_user_id ?? null,
    external_profile_id: patch.external_profile_id ?? null,
    avatar_url: patch.avatar_url ?? null,
    is_private: patch.is_private ?? null,
    is_verified: patch.is_verified ?? null,
    followers_count: patch.followers_count ?? null,
    reason: patch.reason ?? status,
    checked_at: patch.checked_at ?? safeNow(options),
    metadata: safeInstagramPublicMetadata(patch.metadata),
  };
}

function providerMode(options: InstagramPublicProfileLookupOptions) {
  return (options.provider ?? process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER ?? "disabled").trim().toLowerCase();
}

function mapProviderStatus(value: unknown): InstagramPublicProfileLookupStatus {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    status === "found" ||
    status === "not_found" ||
    status === "username_invalid" ||
    status === "unavailable" ||
    status === "rate_limited" ||
    status === "provider_not_configured" ||
    status === "provider_error"
  ) {
    return status;
  }
  return "provider_error";
}

function fromProviderPayload(
  inputUsername: string,
  payload: Record<string, unknown>,
  options: InstagramPublicProfileLookupOptions,
) {
  const status = mapProviderStatus(payload.status);
  const canonicalUsername = normalizeInstagramPublicUsername(readString(payload, ["canonical_username", "username"]));
  const avatarUrl = safeInstagramPublicAvatarUrl(payload.avatar_url ?? payload.profile_pic_url ?? payload.profile_picture_url);
  return result(inputUsername, status, options, {
    canonical_username: canonicalUsername || null,
    instagram_user_id: readString(payload, ["instagram_user_id", "instagram_id"]) || null,
    external_profile_id: readString(payload, ["external_profile_id", "id"]) || null,
    avatar_url: avatarUrl,
    is_private: readBoolean(payload, ["is_private", "private"]),
    is_verified: readBoolean(payload, ["is_verified", "verified"]),
    followers_count: readFollowersCount(payload),
    reason: safeReason(payload.reason, status),
    metadata: {
      provider_mode: providerMode(options),
      provider_status: status,
      ...(payload.metadata && typeof payload.metadata === "object" ? safeInstagramPublicMetadata(payload.metadata) : {}),
    },
  });
}

function notFoundReason(value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase();
  return normalized.includes("not_found") || normalized.includes("not found") || normalized.includes("does not exist");
}

function fromSearchApiPayload(
  inputUsername: string,
  payload: Record<string, unknown>,
  options: InstagramPublicProfileLookupOptions,
) {
  const explicitStatus = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  const error = readString(payload, ["error", "message", "reason"]);
  if (explicitStatus === "not_found" || notFoundReason(error)) {
    return result(inputUsername, "not_found", options, {
      reason: "not_found",
      metadata: { provider_mode: "searchapi", provider_status: "not_found" },
    });
  }

  const profile = readRecord(payload, ["profile", "user", "instagram_profile", "data"]) ?? payload;
  const username = readString(profile, ["username", "user_name", "handle"]);
  const id = readString(profile, ["id", "user_id", "instagram_user_id", "pk"]);
  const avatarUrl = safeInstagramPublicAvatarUrl(
    profile.avatar_url ??
      profile.avatar_hd ??
      profile.avatar ??
      profile.profile_pic_url ??
      profile.profile_picture_url ??
      profile.thumbnail,
  );
  const followersCount = readFollowersCount({
    followers_count: profile.followers_count ?? profile.followers ?? profile.follower_count,
  });

  if (!username && followersCount === null && !avatarUrl && !id) {
    return result(inputUsername, "provider_error", options, {
      reason: "provider_invalid_response",
      metadata: { provider_mode: "searchapi", provider_status: "provider_error" },
    });
  }

  return result(inputUsername, "found", options, {
    canonical_username: normalizeInstagramPublicUsername(username || inputUsername),
    external_profile_id: id || null,
    avatar_url: avatarUrl,
    is_private: readBoolean(profile, ["is_private", "private"]),
    is_verified: readBoolean(profile, ["is_verified", "verified"]),
    followers_count: followersCount,
    reason: "found",
    metadata: {
      provider_mode: "searchapi",
      provider_status: "found",
      provider_engine: "instagram_profile",
    },
  });
}

function mockLookup(inputUsername: string, options: InstagramPublicProfileLookupOptions) {
  const status = mapProviderStatus(process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_STATUS ?? "provider_not_configured");
  const canonical = normalizeInstagramPublicUsername(
    process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_CANONICAL_USERNAME ?? inputUsername,
  );
  const payload: Record<string, unknown> = {
    status,
    canonical_username: canonical,
    instagram_user_id: process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_INSTAGRAM_USER_ID,
    external_profile_id: process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_EXTERNAL_PROFILE_ID,
    avatar_url: process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_AVATAR_URL,
    is_private: readMockBoolean(process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_IS_PRIVATE),
    is_verified: readMockBoolean(process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_IS_VERIFIED),
    followers_count: process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_FOLLOWERS_COUNT,
    reason: process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MOCK_REASON ?? status,
    metadata: { provider_mode: "mock" },
  };
  return fromProviderPayload(inputUsername, payload, options);
}

async function httpLookup(inputUsername: string, options: InstagramPublicProfileLookupOptions) {
  const endpoint = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL?.trim();
  if (!endpoint) {
    return result(inputUsername, "provider_not_configured", options, {
      reason: "provider_not_configured",
      metadata: { provider_mode: "http" },
    });
  }

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000);

  try {
    const url = new URL(endpoint);
    url.searchParams.set("username", inputUsername);
    const response = await fetcher(url.toString(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 404) return result(inputUsername, "not_found", options, { reason: "not_found" });
    if (response.status === 429) return result(inputUsername, "rate_limited", options, { reason: "rate_limited" });
    if (!response.ok) return result(inputUsername, "provider_error", options, { reason: "provider_http_error" });

    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return result(inputUsername, "provider_error", options, { reason: "provider_invalid_response" });
    }
    return fromProviderPayload(inputUsername, payload as Record<string, unknown>, options);
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_error";
    return result(inputUsername, reason === "provider_timeout" ? "unavailable" : "provider_error", options, { reason });
  } finally {
    clearTimeout(timeout);
  }
}

async function searchApiLookup(inputUsername: string, options: InstagramPublicProfileLookupOptions) {
  const endpoint = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL?.trim();
  const apiKey = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim();
  if (!endpoint || !apiKey) {
    return result(inputUsername, "provider_not_configured", options, {
      reason: "provider_not_configured",
      metadata: { provider_mode: "searchapi" },
    });
  }

  const cached = readSearchApiCache(inputUsername, options);
  if (cached) return cached;

  return await runSearchApiSerialized(async () => {
    const queuedCached = readSearchApiCache(inputUsername, options);
    if (queuedCached) return queuedCached;

    const throttled = checkSearchApiThrottle(inputUsername, options);
    if (throttled) {
      writeSearchApiCache(inputUsername, throttled, options);
      return throttled;
    }

    const fetcher = options.fetcher ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 7000);
    const startedAtMs = Date.now();
    const finalize = (lookup: InstagramPublicProfileLookupResult) => {
      const safeLookup = withLookupMetadata(lookup, {
        cache_hit: false,
        throttle_hit: false,
        rate_limited: lookup.status === "rate_limited",
        latency_ms: Math.max(Date.now() - startedAtMs, 0),
      });
      writeSearchApiCache(inputUsername, safeLookup, options);
      return safeLookup;
    };

    try {
      const url = new URL(endpoint);
      if (!url.searchParams.has("engine")) url.searchParams.set("engine", "instagram_profile");
      url.searchParams.set("username", inputUsername);
      url.searchParams.set("api_key", apiKey);
      const response = await fetcher(url.toString(), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.status === 404) return finalize(result(inputUsername, "not_found", options, { reason: "not_found" }));
      if (response.status === 429) return finalize(result(inputUsername, "rate_limited", options, { reason: "rate_limited" }));
      if (response.status >= 500) return finalize(result(inputUsername, "unavailable", options, { reason: "provider_unavailable" }));
      if (!response.ok) return finalize(result(inputUsername, "provider_error", options, { reason: "provider_http_error" }));

      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return finalize(result(inputUsername, "provider_error", options, { reason: "provider_invalid_response" }));
      }
      return finalize(fromSearchApiPayload(inputUsername, payload as Record<string, unknown>, options));
    } catch (error) {
      const reason = error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_error";
      return finalize(result(inputUsername, reason === "provider_timeout" ? "unavailable" : "provider_error", options, { reason }));
    } finally {
      clearTimeout(timeout);
    }
  });
}

export async function lookupInstagramPublicProfile(
  username: string,
  options: InstagramPublicProfileLookupOptions = {},
) {
  const inputUsername = normalizeInstagramPublicUsername(username);
  if (!isPlausibleInstagramPublicUsername(inputUsername)) {
    return result(inputUsername, "username_invalid", options, { reason: "invalid_format" });
  }

  const provider = providerMode(options);
  if (provider === "mock") return mockLookup(inputUsername, options);
  if (provider === "http") return await httpLookup(inputUsername, options);
  if (provider === "searchapi") return await searchApiLookup(inputUsername, options);

  return result(inputUsername, "provider_not_configured", options, {
    reason: "provider_not_configured",
    metadata: { provider_mode: provider || "disabled" },
  });
}
