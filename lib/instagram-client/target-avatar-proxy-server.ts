import { safeExternalImageUrl } from "@/lib/instagram-dashboard/safe-external-url";
import { lookupInstagramPublicProfile, normalizeInstagramPublicUsername } from "@/lib/instagram-public-profile-lookup";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const avatarUrlCache = new Map<string, { url: string; expiresAtMs: number }>();
const AVATAR_URL_CACHE_TTL_MS = 10 * 60 * 1000;

const upstreamHeaders = {
  Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://www.instagram.com/",
};

export type TargetAvatarUpstreamResult = {
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
  resolvedAvatarUrl: string;
  refreshedFromProvider: boolean;
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

async function fetchAvatarBytes(avatarUrl: string) {
  const upstream = await fetch(avatarUrl, {
    headers: upstreamHeaders,
    cache: "no-store",
  });
  if (!upstream.ok) return null;

  const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!allowedImageTypes.has(contentType)) return null;

  return {
    body: upstream.body,
    contentType,
    resolvedAvatarUrl: avatarUrl,
  };
}

export async function resolveTargetAvatarUpstream(input: {
  username: string;
  storedAvatarUrl?: string | null;
  allowProviderRefresh?: boolean;
}): Promise<TargetAvatarUpstreamResult | null> {
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
    const lookup = await lookupInstagramPublicProfile(username);
    fresh = lookup.status === "found" ? safeExternalImageUrl(lookup.avatar_url ?? "") : null;
    if (fresh) {
      cacheResolvedAvatarUrl(username, fresh);
      if (!candidates.includes(fresh)) candidates.unshift(fresh);
    }
  }

  for (const avatarUrl of candidates) {
    const fetched = await fetchAvatarBytes(avatarUrl);
    if (!fetched) continue;
    cacheResolvedAvatarUrl(username, avatarUrl);
    return {
      ...fetched,
      refreshedFromProvider: Boolean(fresh && avatarUrl === fresh && avatarUrl !== stored),
    };
  }

  if (fresh) return null;
  if (!shouldRefresh && candidates.length > 0) {
    const lookup = await lookupInstagramPublicProfile(username);
    const retryFresh = lookup.status === "found" ? safeExternalImageUrl(lookup.avatar_url ?? "") : null;
    if (retryFresh && !candidates.includes(retryFresh)) {
      const fetched = await fetchAvatarBytes(retryFresh);
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
}

export { allowedImageTypes as targetAvatarAllowedImageTypes };
