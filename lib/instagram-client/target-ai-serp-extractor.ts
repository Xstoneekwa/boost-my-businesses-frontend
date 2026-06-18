import { extractInstagramUsernameFromUrl } from "./target-ai-instagram-url.ts";

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
  if (blockedUsernameHints.has(username.toLowerCase())) return null;
  return username;
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

  const profileUrl = link && extractInstagramUsernameFromUrl(link) === username
    ? link
    : `https://www.instagram.com/${encodeURIComponent(username)}/`;

  return {
    username,
    profileUrl,
    title: input.row.title?.trim() || null,
    snippet: input.row.snippet?.trim() || null,
    displayedLink: displayedLink || null,
    sourceQuery: input.sourceQuery,
    position: input.position,
  };
}

export function extractSerpProfilesFromOrganicResults(input: {
  rows: SerpOrganicRow[];
  sourceQuery: string;
}) {
  const output: SerpProfileCandidate[] = [];
  input.rows.forEach((row, index) => {
    const candidate = extractSerpProfileFromOrganicRow({
      row,
      sourceQuery: input.sourceQuery,
      position: index + 1,
    });
    if (candidate) output.push(candidate);
  });
  return output;
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
