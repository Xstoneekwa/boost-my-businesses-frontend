import { safeExternalImageUrl } from "../instagram-dashboard/safe-external-url.ts";
import { lookupInstagramPublicProfile, normalizeInstagramPublicUsername } from "../instagram-public-profile-lookup.ts";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const avatarUrlCache = new Map<string, { url: string; expiresAtMs: number }>();
const AVATAR_URL_CACHE_TTL_MS = 10 * 60 * 1000;
const AVATAR_FETCH_TIMEOUT_MS = 8_000;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

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

type TargetAvatarProxyDependencies = {
  fetcher?: typeof fetch;
  lookup?: typeof lookupInstagramPublicProfile;
};

function readCachedAvatarUrl(username: string) {
  const cached = avatarUrlCache.get(username);
  if (!cached || cached.expiresAtMs <= Date.now()) {
    if (cached) avatarUrlCache.delete(username);
    return null;
  }
  return cached.url;
}

export function cacheResolvedAvatarUrl(username: string, avatarUrl: string) {
  const safe = safeExternalImageUrl(avatarUrl);
  if (!safe) return;
  avatarUrlCache.set(username, {
    url: safe,
    expiresAtMs: Date.now() + AVATAR_URL_CACHE_TTL_MS,
  });
}

export function resetTargetAvatarProxyCacheForTests() {
  avatarUrlCache.clear();
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

async function fetchAvatarBytes(avatarUrl: string, dependencies: TargetAvatarProxyDependencies = {}) {
  try {
    const upstream = await (dependencies.fetcher ?? fetch)(avatarUrl, {
      headers: upstreamHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS),
    });
    if (!upstream.ok) return null;

    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!allowedImageTypes.has(contentType)) return null;
    const contentLength = Number(upstream.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > AVATAR_MAX_BYTES) return null;
    const body = await readBoundedImageBody(upstream.body);
    if (!body) return null;

    return {
      body,
      contentType,
      resolvedAvatarUrl: avatarUrl,
    };
  } catch (error) {
    if (isExpectedAvatarFetchFailure(error)) return null;
    console.warn("[Target avatar proxy] unexpected avatar fetch failure");
    return null;
  }
}

export async function resolveTargetAvatarUpstream(input: {
  username: string;
  storedAvatarUrl?: string | null;
  allowProviderRefresh?: boolean;
}, dependencies: TargetAvatarProxyDependencies = {}): Promise<TargetAvatarUpstreamResult | null> {
  try {
    const username = normalizeInstagramPublicUsername(input.username);
    const candidates: string[] = [];
    const cached = readCachedAvatarUrl(username);
    if (cached) candidates.push(cached);

    const stored = safeExternalImageUrl(input.storedAvatarUrl ?? "");
    if (stored && !candidates.includes(stored)) candidates.push(stored);

    let fresh: string | null = null;
    const shouldRefresh = input.allowProviderRefresh !== false
      && !cached
      && candidates.every((url) => !url.includes("scontent-"));

    if (shouldRefresh || candidates.length === 0) {
      const lookup = await (dependencies.lookup ?? lookupInstagramPublicProfile)(username);
      fresh = lookup.status === "found" ? safeExternalImageUrl(lookup.avatar_url ?? "") : null;
      if (fresh) {
        cacheResolvedAvatarUrl(username, fresh);
        if (!candidates.includes(fresh)) candidates.unshift(fresh);
      }
    }

    for (const avatarUrl of candidates) {
      const fetched = await fetchAvatarBytes(avatarUrl, dependencies);
      if (!fetched) continue;
      cacheResolvedAvatarUrl(username, avatarUrl);
      return {
        ...fetched,
        refreshedFromProvider: Boolean(fresh && avatarUrl === fresh && avatarUrl !== stored),
      };
    }

    if (fresh) return null;
    if (input.allowProviderRefresh !== false && !shouldRefresh && candidates.length > 0) {
      const lookup = await (dependencies.lookup ?? lookupInstagramPublicProfile)(username);
      const retryFresh = lookup.status === "found" ? safeExternalImageUrl(lookup.avatar_url ?? "") : null;
      if (retryFresh && !candidates.includes(retryFresh)) {
        const fetched = await fetchAvatarBytes(retryFresh, dependencies);
        if (fetched) {
          cacheResolvedAvatarUrl(username, retryFresh);
          return {
            ...fetched,
            refreshedFromProvider: true,
          };
        }
      }
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
