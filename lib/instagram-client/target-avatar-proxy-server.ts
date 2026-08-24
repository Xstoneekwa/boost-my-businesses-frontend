import { safeExternalImageUrl } from "../instagram-dashboard/safe-external-url.ts";
import { lookupInstagramPublicProfile, normalizeInstagramPublicUsername } from "../instagram-public-profile-lookup.ts";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const avatarUrlCache = new Map<string, { url: string; expiresAtMs: number }>();
const avatarFailureCache = new Map<string, { expiresAtMs: number }>();
const AVATAR_URL_CACHE_TTL_MS = 10 * 60 * 1000;
const AVATAR_FETCH_TIMEOUT_MS = 8_000;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_FAILURE_CACHE_MAX_ENTRIES = 500;
const AVATAR_FAILURE_CACHE_MAX_TTL_MS = 5 * 60 * 1000;

const upstreamHeaders = {
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://www.instagram.com/",
};

export type TargetAvatarUpstreamResult = {
  body: Uint8Array<ArrayBuffer> | null;
  contentType: string;
  resolvedAvatarUrl: string;
  refreshedFromProvider: boolean;
};

export type TargetAvatarProxyEvent =
  | {
    type: "negative_cache";
    result: "hit" | "stored" | "cleared";
  }
  | {
    type: "provider_refresh";
    result: "found" | "unavailable" | "invalid_url" | "same_url" | "error";
  }
  | {
    type: "upstream_fetch";
    source: "cached" | "stored" | "provider_refresh";
    hostname: string;
    status: number | null;
    result: "success" | "http_error" | "invalid_content_type" | "oversized" | "empty_body" | "exception";
  };

type TargetAvatarProxyDependencies = {
  fetcher?: typeof fetch;
  lookup?: typeof lookupInstagramPublicProfile;
  now?: () => number;
  onEvent?: (event: TargetAvatarProxyEvent) => void;
};

function emitEvent(dependencies: TargetAvatarProxyDependencies, event: TargetAvatarProxyEvent) {
  dependencies.onEvent?.(event);
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "invalid";
  }
}

function readCachedAvatarUrl(username: string, nowMs: number) {
  const cached = avatarUrlCache.get(username);
  if (!cached || cached.expiresAtMs <= nowMs) {
    if (cached) avatarUrlCache.delete(username);
    return null;
  }
  return cached.url;
}

export function cacheResolvedAvatarUrl(username: string, avatarUrl: string, nowMs = Date.now()) {
  const safe = safeExternalImageUrl(avatarUrl);
  if (!safe) return;
  avatarUrlCache.set(username, {
    url: safe,
    expiresAtMs: nowMs + AVATAR_URL_CACHE_TTL_MS,
  });
}

export function resetTargetAvatarProxyCacheForTests() {
  avatarUrlCache.clear();
  avatarFailureCache.clear();
}

function hasCachedFailure(username: string, nowMs: number) {
  const cached = avatarFailureCache.get(username);
  if (!cached || cached.expiresAtMs <= nowMs) {
    if (cached) avatarFailureCache.delete(username);
    return false;
  }
  return true;
}

function cacheFailure(username: string, ttlMs: number, nowMs: number) {
  const boundedTtlMs = Math.min(Math.max(ttlMs, 0), AVATAR_FAILURE_CACHE_MAX_TTL_MS);
  if (boundedTtlMs <= 0) return;
  while (avatarFailureCache.size >= AVATAR_FAILURE_CACHE_MAX_ENTRIES) {
    const oldestKey = avatarFailureCache.keys().next().value;
    if (!oldestKey) break;
    avatarFailureCache.delete(oldestKey);
  }
  avatarFailureCache.set(username, { expiresAtMs: nowMs + boundedTtlMs });
}

function isExpectedAvatarFetchFailure(error: unknown) {
  if (!(error instanceof Error)) return true;
  const message = error.message.toLowerCase();
  return error.name === "AbortError"
    || message.includes("enotfound")
    || message.includes("timeout")
    || message.includes("fetch failed")
    || message.includes("network")
    || message.includes("econnreset")
    || message.includes("certificate");
}

async function readBoundedImageBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > AVATAR_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function fetchAvatarBytes(
  avatarUrl: string,
  source: "cached" | "stored" | "provider_refresh",
  dependencies: TargetAvatarProxyDependencies = {},
) {
  const hostname = safeHostname(avatarUrl);
  try {
    const upstream = await (dependencies.fetcher ?? fetch)(avatarUrl, {
      headers: upstreamHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      emitEvent(dependencies, { type: "upstream_fetch", source, hostname, status: upstream.status, result: "http_error" });
      return null;
    }

    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!allowedImageTypes.has(contentType)) {
      emitEvent(dependencies, { type: "upstream_fetch", source, hostname, status: upstream.status, result: "invalid_content_type" });
      return null;
    }
    const contentLength = Number(upstream.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > AVATAR_MAX_BYTES) {
      emitEvent(dependencies, { type: "upstream_fetch", source, hostname, status: upstream.status, result: "oversized" });
      return null;
    }
    if (!upstream.body) {
      emitEvent(dependencies, { type: "upstream_fetch", source, hostname, status: upstream.status, result: "empty_body" });
      return null;
    }
    const body = await readBoundedImageBody(upstream.body);
    if (!body) {
      emitEvent(dependencies, { type: "upstream_fetch", source, hostname, status: upstream.status, result: "oversized" });
      return null;
    }

    emitEvent(dependencies, { type: "upstream_fetch", source, hostname, status: upstream.status, result: "success" });

    return {
      body,
      contentType,
      resolvedAvatarUrl: avatarUrl,
    };
  } catch (error) {
    emitEvent(dependencies, { type: "upstream_fetch", source, hostname, status: null, result: "exception" });
    if (isExpectedAvatarFetchFailure(error)) return null;
    console.warn("[Target avatar proxy] unexpected avatar fetch failure");
    return null;
  }
}

export async function resolveTargetAvatarUpstream(input: {
  username: string;
  storedAvatarUrl?: string | null;
  allowProviderRefresh?: boolean;
  negativeCacheTtlMs?: number;
}, dependencies: TargetAvatarProxyDependencies = {}): Promise<TargetAvatarUpstreamResult | null> {
  try {
    const username = normalizeInstagramPublicUsername(input.username);
    const nowMs = (dependencies.now ?? Date.now)();
    if (input.negativeCacheTtlMs && hasCachedFailure(username, nowMs)) {
      emitEvent(dependencies, { type: "negative_cache", result: "hit" });
      return null;
    }

    const candidates: Array<{ url: string; source: "cached" | "stored" | "provider_refresh" }> = [];
    const cached = readCachedAvatarUrl(username, nowMs);
    if (cached) candidates.push({ url: cached, source: "cached" });

    const stored = safeExternalImageUrl(input.storedAvatarUrl ?? "");
    if (stored && !candidates.some((candidate) => candidate.url === stored)) {
      candidates.push({ url: stored, source: "stored" });
    }

    let fresh: string | null = null;
    const shouldRefresh = input.allowProviderRefresh !== false
      && !cached
      && candidates.every((candidate) => !candidate.url.includes("scontent-"));

    async function lookupFreshAvatar() {
      try {
        const lookup = await (dependencies.lookup ?? lookupInstagramPublicProfile)(username);
        if (lookup.status !== "found") {
          emitEvent(dependencies, { type: "provider_refresh", result: "unavailable" });
          return null;
        }
        const safe = safeExternalImageUrl(lookup.avatar_url ?? "");
        emitEvent(dependencies, { type: "provider_refresh", result: safe ? "found" : "invalid_url" });
        return safe;
      } catch {
        emitEvent(dependencies, { type: "provider_refresh", result: "error" });
        return null;
      }
    }

    if (shouldRefresh || candidates.length === 0) {
      fresh = await lookupFreshAvatar();
      if (fresh) {
        cacheResolvedAvatarUrl(username, fresh, nowMs);
        if (!candidates.some((candidate) => candidate.url === fresh)) {
          candidates.unshift({ url: fresh, source: "provider_refresh" });
        } else {
          emitEvent(dependencies, { type: "provider_refresh", result: "same_url" });
        }
      }
    }

    for (const candidate of candidates) {
      const fetched = await fetchAvatarBytes(candidate.url, candidate.source, dependencies);
      if (!fetched) continue;
      if (avatarFailureCache.delete(username)) {
        emitEvent(dependencies, { type: "negative_cache", result: "cleared" });
      }
      cacheResolvedAvatarUrl(username, candidate.url, nowMs);
      return {
        ...fetched,
        refreshedFromProvider: Boolean(fresh && candidate.url === fresh && candidate.url !== stored),
      };
    }

    if (fresh) {
      if (input.negativeCacheTtlMs) {
        cacheFailure(username, input.negativeCacheTtlMs, nowMs);
        emitEvent(dependencies, { type: "negative_cache", result: "stored" });
      }
      return null;
    }
    if (input.allowProviderRefresh !== false && !shouldRefresh && candidates.length > 0) {
      const retryFresh = await lookupFreshAvatar();
      if (retryFresh && !candidates.some((candidate) => candidate.url === retryFresh)) {
        const fetched = await fetchAvatarBytes(retryFresh, "provider_refresh", dependencies);
        if (fetched) {
          if (avatarFailureCache.delete(username)) {
            emitEvent(dependencies, { type: "negative_cache", result: "cleared" });
          }
          cacheResolvedAvatarUrl(username, retryFresh, nowMs);
          return {
            ...fetched,
            refreshedFromProvider: true,
          };
        }
      } else if (retryFresh) {
        emitEvent(dependencies, { type: "provider_refresh", result: "same_url" });
      }
    }

    if (input.negativeCacheTtlMs) {
      cacheFailure(username, input.negativeCacheTtlMs, nowMs);
      emitEvent(dependencies, { type: "negative_cache", result: "stored" });
    }

    return null;
  } catch {
    return null;
  }
}

export {
  AVATAR_MAX_BYTES as targetAvatarMaxBytes,
  allowedImageTypes as targetAvatarAllowedImageTypes,
};
