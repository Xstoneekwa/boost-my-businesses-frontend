import { normalizeTargetUsername } from "../instagram-targets.ts";

const blockedInstagramPathSegments = new Set([
  "p",
  "reel",
  "reels",
  "explore",
  "stories",
  "accounts",
  "tv",
  "tags",
  "directory",
  "about",
  "legal",
  "developer",
  "api",
  "direct",
  "nametag",
  "business",
  "help",
  "privacy",
  "terms",
  "press",
  "jobs",
]);

const instagramUrlPattern = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-z0-9._]{1,30})(?:[/?#]|$)/gi;

function isBlockedSegment(segment: string) {
  return blockedInstagramPathSegments.has(segment.toLowerCase());
}

function acceptInstagramUsername(value: string) {
  const normalized = normalizeTargetUsername(value);
  if (!normalized || isBlockedSegment(normalized)) return null;
  return normalized;
}

export function extractInstagramUsernameFromUrl(value: string) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (host !== "instagram.com") return null;
    const [firstSegment] = parsed.pathname.split("/").filter(Boolean);
    if (!firstSegment) return null;
    return acceptInstagramUsername(firstSegment);
  } catch {
    return null;
  }
}

export function extractInstagramUsernamesFromText(value: string) {
  const output: string[] = [];
  const seen = new Set<string>();
  instagramUrlPattern.lastIndex = 0;
  let match = instagramUrlPattern.exec(value);
  while (match) {
    const normalized = acceptInstagramUsername(match[1] ?? "");
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
    match = instagramUrlPattern.exec(value);
  }
  return output;
}

export function extractInstagramUsernamesFromSearchResult(input: {
  link?: string | null;
  title?: string | null;
  snippet?: string | null;
  displayed_link?: string | null;
}) {
  const seen = new Set<string>();
  const output: string[] = [];

  function push(value: string | null | undefined) {
    if (!value) return;
    const fromUrl = extractInstagramUsernameFromUrl(value);
    if (fromUrl && !seen.has(fromUrl)) {
      seen.add(fromUrl);
      output.push(fromUrl);
    }
    for (const username of extractInstagramUsernamesFromText(value)) {
      if (seen.has(username)) continue;
      seen.add(username);
      output.push(username);
    }
  }

  push(input.link);
  push(input.displayed_link);
  push(input.title);
  push(input.snippet);
  return output;
}

export function mergeDiscoveredUsernames(
  batches: string[][],
  maxUsernames: number,
) {
  const seen = new Set<string>();
  const output: string[] = [];
  let duplicateSkipped = 0;

  for (const batch of batches) {
    for (const raw of batch) {
      const normalized = normalizeTargetUsername(raw);
      if (!normalized) continue;
      if (seen.has(normalized)) {
        duplicateSkipped += 1;
        continue;
      }
      seen.add(normalized);
      output.push(normalized);
      if (output.length >= maxUsernames) {
        return { usernames: output, duplicateSkipped };
      }
    }
  }

  return { usernames: output, duplicateSkipped };
}
