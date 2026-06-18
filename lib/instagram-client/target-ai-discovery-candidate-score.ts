import { scoreTargetAiCandidateRelevance } from "./target-ai-relevance-score.ts";
import { parseTargetAiLocationParts } from "./target-ai-discovery-queries.ts";

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function includesLocationHint(text: string, locationLabel?: string | null) {
  if (!locationLabel) return true;
  const parts = parseTargetAiLocationParts(locationLabel);
  const haystack = normalizeText(text);
  if (haystack.includes(normalizeText(parts.city))) return true;
  if (parts.region && haystack.includes(normalizeText(parts.region))) return true;
  if (parts.country && haystack.includes(normalizeText(parts.country))) return true;
  return false;
}

export function scoreDiscoveryCandidate(input: {
  username: string;
  niche: string;
  locationLabel?: string | null;
  sourceQuery: string;
  title?: string | null;
  snippet?: string | null;
}) {
  const combined = `${input.title ?? ""} ${input.snippet ?? ""} ${input.sourceQuery}`;
  let score = scoreTargetAiCandidateRelevance({
    username: input.username,
    niche: input.niche,
    locationLabel: input.locationLabel,
    profileName: input.title,
    biography: input.snippet,
  });

  if (includesLocationHint(input.sourceQuery, input.locationLabel)) score += 6;
  if (includesLocationHint(combined, input.locationLabel)) score += 4;
  if (input.locationLabel && !includesLocationHint(combined, input.locationLabel)) score -= 6;

  const genericTerms = ["news", "media", "official", "magazine", "tv", "university"];
  if (genericTerms.some((term) => normalizeText(combined).includes(term))) score -= 4;

  return score;
}

export function rankDiscoveryCandidates<T extends { username: string; discoveryScore: number }>(candidates: T[]) {
  return [...candidates].sort((left, right) => right.discoveryScore - left.discoveryScore);
}
