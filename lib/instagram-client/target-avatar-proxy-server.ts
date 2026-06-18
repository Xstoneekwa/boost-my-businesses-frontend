import { safeExternalImageUrl } from "@/lib/instagram-dashboard/safe-external-url";
import { lookupInstagramPublicProfile, normalizeInstagramPublicUsername } from "@/lib/instagram-public-profile-lookup";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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
}): Promise<TargetAvatarUpstreamResult | null> {
  const username = normalizeInstagramPublicUsername(input.username);
  const candidates: string[] = [];
  const stored = safeExternalImageUrl(input.storedAvatarUrl ?? "");
  if (stored) candidates.push(stored);

  const lookup = await lookupInstagramPublicProfile(username);
  const fresh = lookup.status === "found" ? safeExternalImageUrl(lookup.avatar_url ?? "") : null;
  if (fresh && !candidates.includes(fresh)) {
    candidates.unshift(fresh);
  }

  for (const avatarUrl of candidates) {
    const fetched = await fetchAvatarBytes(avatarUrl);
    if (!fetched) continue;
    return {
      ...fetched,
      refreshedFromProvider: Boolean(fresh && avatarUrl === fresh && avatarUrl !== stored),
    };
  }

  return null;
}

export { allowedImageTypes as targetAvatarAllowedImageTypes };
