import {
  extractInstagramUsernameFromUrl,
  extractInstagramUsernamesFromSearchResult,
} from "./target-ai-instagram-url.ts";

export type SerpOrganicRow = {
  link?: string | null;
  title?: string | null;
  snippet?: string | null;
  displayed_link?: string | null;
};

export type SerpProfileCandidate = {
  username: string;
  profileUrl: string;
  title: string | null;
  snippet: string | null;
  displayedLink: string | null;
  sourceQuery: string;
  position: number;
  extractionMode?: "strict" | "loose";
};

export type SerpExtractionStats = {
  organic_rows: number;
  instagram_urls: number;
  profile_urls: number;
  strict_extracted: number;
  loose_extracted: number;
  rejected_non_profile: number;
  rejections_by_reason: Record<string, number>;
};

const blockedUsernameHints = new Set([
  "explore",
  "popular",
  "instagram",
  "about",
  "reels",
  "stories",
]);

function acceptProfileUsername(username: string | null) {
  if (!username) return null;
  const normalized = username.trim();
  if (!/^[a-z0-9._]{1,30}$/i.test(normalized)) return null;
  if (blockedUsernameHints.has(normalized.toLowerCase())) return null;
  return normalized;
}

function isInstagramUrl(value: string) {
  return /instagram\.com/i.test(value || "");
}

function isProfileInstagramUrl(value: string) {
  return Boolean(extractInstagramUsernameFromUrl(String(value || "")));
}

function rowHasInstagramContext(row: SerpOrganicRow) {
  const combined = `${row.link ?? ""} ${row.displayed_link ?? ""} ${row.title ?? ""} ${row.snippet ?? ""}`;
  return isInstagramUrl(combined);
}

export function extractSerpProfileFromOrganicRow(input: {
  row: SerpOrganicRow;
  sourceQuery: string;
  position: number;
}): SerpProfileCandidate | null {
  const link = input.row.link?.trim() || "";
  const displayedLink = input.row.displayed_link?.trim() || "";
  const usernameFromLink = acceptProfileUsername(extractInstagramUsernameFromUrl(link));
  const usernameFromDisplayed = acceptProfileUsername(extractInstagramUsernameFromUrl(displayedLink));
  const username = usernameFromLink || usernameFromDisplayed;
  if (!username) return null;

  const profileUrl = usernameFromLink && link
    ? link
    : usernameFromDisplayed && displayedLink
      ? displayedLink
      : `https://www.instagram.com/${encodeURIComponent(username)}/`;

  return {
    username,
    profileUrl,
    title: input.row.title?.trim() || null,
    snippet: input.row.snippet?.trim() || null,
    displayedLink: displayedLink || null,
    sourceQuery: input.sourceQuery,
    position: input.position,
    extractionMode: "strict",
  };
}

export function extractLooseSerpProfileFromOrganicRow(input: {
  row: SerpOrganicRow;
  sourceQuery: string;
  position: number;
}): SerpProfileCandidate | null {
  if (!rowHasInstagramContext(input.row)) return null;

  const usernames = extractInstagramUsernamesFromSearchResult(input.row)
    .map((username) => acceptProfileUsername(username))
    .filter((username): username is string => Boolean(username));

  if (usernames.length === 0) return null;

  const username = usernames[0];
  const link = input.row.link?.trim() || "";
  const displayedLink = input.row.displayed_link?.trim() || "";
  const profileUrl = extractInstagramUsernameFromUrl(link) === username && link
    ? link
    : extractInstagramUsernameFromUrl(displayedLink) === username && displayedLink
      ? displayedLink
      : `https://www.instagram.com/${encodeURIComponent(username)}/`;

  return {
    username,
    profileUrl,
    title: input.row.title?.trim() || null,
    snippet: input.row.snippet?.trim() || null,
    displayedLink: displayedLink || null,
    sourceQuery: input.sourceQuery,
    position: input.position,
    extractionMode: "loose",
  };
}

export function extractSerpProfileFromOrganicRowWithFallback(input: {
  row: SerpOrganicRow;
  sourceQuery: string;
  position: number;
}) {
  return extractSerpProfileFromOrganicRow(input) ?? extractLooseSerpProfileFromOrganicRow(input);
}

export function extractSerpProfilesFromOrganicResults(input: {
  rows: SerpOrganicRow[];
  sourceQuery: string;
}) {
  const output: SerpProfileCandidate[] = [];
  const seen = new Set<string>();

  input.rows.forEach((row, index) => {
    const candidate = extractSerpProfileFromOrganicRowWithFallback({
      row,
      sourceQuery: input.sourceQuery,
      position: index + 1,
    });
    if (!candidate) return;
    const key = candidate.username.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(candidate);
  });

  return output;
}

export function summarizeSerpExtractionFromOrganicResults(input: {
  rows: SerpOrganicRow[];
  sourceQuery: string;
}) {
  const stats: SerpExtractionStats = {
    organic_rows: input.rows.length,
    instagram_urls: 0,
    profile_urls: 0,
    strict_extracted: 0,
    loose_extracted: 0,
    rejected_non_profile: 0,
    rejections_by_reason: {},
  };

  const seen = new Set<string>();

  input.rows.forEach((row, index) => {
    const link = row.link ?? "";
    const displayed = row.displayed_link ?? "";
    const combined = `${link} ${displayed} ${row.title ?? ""} ${row.snippet ?? ""}`;
    const hasInstagram = isInstagramUrl(combined);
    if (hasInstagram) stats.instagram_urls += 1;
    if (isProfileInstagramUrl(link) || isProfileInstagramUrl(displayed)) stats.profile_urls += 1;

    const strict = extractSerpProfileFromOrganicRow({ row, sourceQuery: input.sourceQuery, position: index + 1 });
    const loose = strict ? null : extractLooseSerpProfileFromOrganicRow({ row, sourceQuery: input.sourceQuery, position: index + 1 });
    const candidate = strict ?? loose;

    if (candidate) {
      const key = candidate.username.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      if (candidate.extractionMode === "loose") stats.loose_extracted += 1;
      else stats.strict_extracted += 1;
      return;
    }

    if (hasInstagram) {
      stats.rejected_non_profile += 1;
      const reason = strict || loose ? "duplicate" : "instagram_non_profile_url";
      stats.rejections_by_reason[reason] = (stats.rejections_by_reason[reason] || 0) + 1;
    }
  });

  return stats;
}

export function dedupeSerpProfileCandidates(candidates: SerpProfileCandidate[], maxCandidates: number) {
  const byUsername = new Map<string, SerpProfileCandidate>();
  for (const candidate of candidates) {
    const existing = byUsername.get(candidate.username);
    if (!existing || candidate.position < existing.position) {
      byUsername.set(candidate.username, candidate);
    }
  }
  return [...byUsername.values()]
    .sort((left, right) => left.position - right.position)
    .slice(0, maxCandidates);
}
