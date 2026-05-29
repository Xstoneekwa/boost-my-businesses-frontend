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

function safeNow(options: InstagramPublicProfileLookupOptions) {
  return (options.now?.() ?? new Date()).toISOString();
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
    profile.avatar_url ?? profile.profile_pic_url ?? profile.profile_picture_url ?? profile.thumbnail,
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

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000);

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

    if (response.status === 404) return result(inputUsername, "not_found", options, { reason: "not_found" });
    if (response.status === 429) return result(inputUsername, "rate_limited", options, { reason: "rate_limited" });
    if (response.status >= 500) return result(inputUsername, "unavailable", options, { reason: "provider_unavailable" });
    if (!response.ok) return result(inputUsername, "provider_error", options, { reason: "provider_http_error" });

    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return result(inputUsername, "provider_error", options, { reason: "provider_invalid_response" });
    }
    return fromSearchApiPayload(inputUsername, payload as Record<string, unknown>, options);
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_error";
    return result(inputUsername, reason === "provider_timeout" ? "unavailable" : "provider_error", options, { reason });
  } finally {
    clearTimeout(timeout);
  }
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
