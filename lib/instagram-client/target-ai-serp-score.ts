import { parseTargetAiLocationParts } from "./target-ai-discovery-queries.ts";
import { combinedTextMatchesNiche, readTargetAiNicheMatchTerms } from "./target-ai-niche-match.ts";
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
  "magazine",
  "university",
  "government",
  "explore",
  "influencer",
  "article",
  "blog post",
  "top 10",
  "best of",
];

const offNichePenaltyTerms = [
  "gallery",
  "galerie",
  "museum",
  "musée",
  "fondation",
  "art ",
  "magazine",
  "diplo",
  "newspaper",
  "journal",
];

const genericUsernames = new Set([
  "popular",
  "instagram",
  "explore",
  "reels",
  "news",
  "media",
]);

const foreignCityHints: Record<string, string[]> = {
  johannesburg: ["paris", "lyon", "bordeaux", "geneve", "genève", "bruxelles", "brussels", "pretoria"],
  bordeaux: ["johannesburg", "sandton", "paris", "lyon", "new york", "london"],
  belgique: ["johannesburg", "sandton", "paris", "lyon", "bordeaux"],
  belgium: ["johannesburg", "sandton", "paris", "lyon", "bordeaux"],
};

function readLocationMatchTerms(locationLabel?: string | null) {
  const location = parseTargetAiLocationParts(locationLabel);
  const terms = new Set<string>();
  if (location.city) terms.add(normalizeText(location.city));
  if (location.region) terms.add(normalizeText(location.region));
  if (location.country) terms.add(normalizeText(location.country));
  if (location.label) {
    for (const part of location.label.split(",").map((entry) => entry.trim()).filter(Boolean)) {
      terms.add(normalizeText(part));
    }
  }
  return [...terms].filter(Boolean);
}

function hasLocationHit(combined: string, sourceQuery: string, locationLabel?: string | null) {
  const terms = readLocationMatchTerms(locationLabel);
  if (terms.some((term) => includesTerm(combined, term))) return true;
  return terms.some((term) => includesTerm(normalizeText(sourceQuery), term));
}

function readForeignCityPenalty(locationLabel?: string | null) {
  const location = parseTargetAiLocationParts(locationLabel);
  const keys = [
    normalizeText(location.city),
    normalizeText(location.country),
    normalizeText(location.label),
  ].filter(Boolean);
  const penalties = new Set<string>();
  for (const key of keys) {
    for (const hint of foreignCityHints[key] ?? []) penalties.add(hint);
  }
  return [...penalties];
}

export function scoreSerpProfileCandidate(input: {
  candidate: SerpProfileCandidate;
  niche: string;
  locationLabel?: string | null;
}) {
  const combined = normalizeText([
    input.candidate.title,
    input.candidate.snippet,
    input.candidate.sourceQuery,
    input.candidate.username,
    input.candidate.displayedLink,
  ].filter(Boolean).join(" "));
  let score = 0;
  let locHit = hasLocationHit(combined, input.candidate.sourceQuery, input.locationLabel);
  let nicheHit = combinedTextMatchesNiche(combined, input.niche);

  for (const term of readTargetAiNicheMatchTerms(input.niche)) {
    if (includesTerm(combined, term)) {
      score += 4;
      nicheHit = true;
    }
  }

  if (locHit) score += 8;
  if (includesTerm(normalizeText(input.candidate.sourceQuery), parseTargetAiLocationParts(input.locationLabel).city)) {
    score += 6;
    locHit = true;
  }

  for (const term of businessTerms) {
    if (combined.includes(term)) score += 2;
  }

  for (const term of penaltyTerms) {
    if (combined.includes(term)) score -= 5;
  }

  for (const term of offNichePenaltyTerms) {
    if (combined.includes(term)) score -= 8;
  }

  for (const foreignCity of readForeignCityPenalty(input.locationLabel)) {
    if (combined.includes(foreignCity) && !hasLocationHit(combined, input.candidate.sourceQuery, input.locationLabel)) {
      score -= 10;
    }
  }

  if (genericUsernames.has(normalizeText(input.candidate.username))) score -= 12;
  if (/^p\/|reel\/|explore|stories/.test(normalizeText(input.candidate.profileUrl))) score -= 20;
  score += Math.max(0, 12 - input.candidate.position);

  return { score, locHit, nicheHit };
}

export function rankSerpProfileCandidates<T extends SerpProfileCandidate>(
  candidates: T[],
  niche: string,
  locationLabel?: string | null,
) {
  return [...candidates]
    .map((candidate) => {
      const scored = scoreSerpProfileCandidate({ candidate, niche, locationLabel });
      return {
        ...candidate,
        serpScore: scored.score,
        locHit: scored.locHit,
        nicheHit: scored.nicheHit,
      };
    })
    .sort((left, right) => right.serpScore - left.serpScore);
}
