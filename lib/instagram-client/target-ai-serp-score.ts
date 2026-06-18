import { parseTargetAiLocationParts } from "./target-ai-discovery-queries.ts";
import type { SerpProfileCandidate } from "./target-ai-serp-extractor.ts";

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function includesTerm(haystack: string, term: string) {
  if (!term) return false;
  return haystack.includes(normalizeText(term));
}

const businessTerms = [
  "restaurant",
  "clinic",
  "cabinet",
  "agency",
  "studio",
  "therapist",
  "psycholog",
  "takeaway",
  "traiteur",
  "official",
  "centre",
  "center",
  "kitchen",
  "bistro",
  "cafe",
];

const penaltyTerms = [
  "news",
  "media",
  "magazine",
  "university",
  "government",
  "explore",
  "popular",
  "influencer",
];

export function scoreSerpProfileCandidate(input: {
  candidate: SerpProfileCandidate;
  niche: string;
  locationLabel?: string | null;
}) {
  const location = parseTargetAiLocationParts(input.locationLabel);
  const combined = normalizeText([
    input.candidate.title,
    input.candidate.snippet,
    input.candidate.sourceQuery,
    input.candidate.username,
    input.candidate.displayedLink,
  ].filter(Boolean).join(" "));
  const niche = normalizeText(input.niche);
  let score = 0;

  for (const token of niche.split(/[^a-z0-9]+/g).filter((entry) => entry.length >= 3)) {
    if (combined.includes(token)) score += 4;
  }

  if (location.city && includesTerm(combined, location.city)) score += 8;
  if (location.region && includesTerm(combined, location.region)) score += 5;
  if (location.country && includesTerm(combined, location.country)) score += 3;
  if (includesTerm(normalizeText(input.candidate.sourceQuery), location.city)) score += 6;

  for (const term of businessTerms) {
    if (combined.includes(term)) score += 2;
  }

  for (const term of penaltyTerms) {
    if (combined.includes(term)) score -= 5;
  }

  if (/^p\/|reel\/|explore|stories/.test(normalizeText(input.candidate.profileUrl))) score -= 20;
  score += Math.max(0, 12 - input.candidate.position);

  return score;
}

export function rankSerpProfileCandidates<T extends SerpProfileCandidate>(
  candidates: T[],
  niche: string,
  locationLabel?: string | null,
) {
  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      serpScore: scoreSerpProfileCandidate({ candidate, niche, locationLabel }),
    }))
    .sort((left, right) => right.serpScore - left.serpScore);
}
