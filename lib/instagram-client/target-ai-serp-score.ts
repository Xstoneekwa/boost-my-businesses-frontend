import { parseTargetAiLocationParts } from "./target-ai-discovery-queries.ts";
import { readTargetAiLocationMatchTerms } from "./target-ai-location-match.ts";
import { combinedTextMatchesNiche, readTargetAiNicheMatchTerms } from "./target-ai-niche-match.ts";
import type { SerpProfileCandidate } from "./target-ai-serp-extractor.ts";

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function includesTerm(haystack: string, term: string) {
  if (!term) return false;
  return haystack.includes(normalizeText(term));
}

function includesAny(haystack: string, terms: string[]) {
  return terms.some((term) => includesTerm(haystack, term));
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
  "foundation",
  "art ",
  "magazine",
  "diplo",
  "newspaper",
  "journal",
  "centre scolaire",
  "school",
  "notre-dame",
  "notre dame",
  "notredame",
  "church",
  "église",
];

const weakProfilePenaltyTerms = [
  "food guide",
  "foodguide",
  "food blogger",
  "foodie",
  "local guide",
  "city guide",
  "best restaurants in",
  "magazine",
  "media",
  "eater_",
  "eater ",
  "corporate",
  "event page",
  "creator",
  "influencer",
  "blogger",
  "noms",
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
  johannesburg: [
    "paris",
    "lyon",
    "bordeaux",
    "geneve",
    "genève",
    "bruxelles",
    "brussels",
    "pretoria",
    "cape town",
    "capetown",
    "lilongwe",
    "malawi",
    "adelaide",
    "washington dc",
    "washington",
    "mâcon",
    "macon",
    "rennes",
    "france",
    "marseille",
  ],
  bordeaux: ["johannesburg", "sandton", "paris", "lyon", "new york", "london", "cape town", "lilongwe"],
  belgique: ["johannesburg", "sandton", "paris", "lyon", "bordeaux", "cape town"],
  belgium: ["johannesburg", "sandton", "paris", "lyon", "bordeaux", "cape town"],
};

const johannesburgLocalTerms = [
  "johannesburg",
  "joburg",
  "jhb",
  "gauteng",
  "sandton",
  "rosebank",
  "randburg",
  "fourways",
  "melrose",
  "norwood",
  "braamfontein",
  "blairgowrie",
  "bedfordview",
  "south africa",
];

const chineseRestaurantBoostTerms = [
  "chinese restaurant",
  "restaurant chinois",
  "dim sum",
  "dumpling",
  "dumplings",
  "noodles",
  "asian restaurant",
  "halaal chinese",
  "chinese food",
  "chinese takeaway",
  "chinese cuisine",
];

const offZoneTitleCities = [
  "cape town",
  "lilongwe",
  "malawi",
  "adelaide",
  "paris",
  "mâcon",
  "macon",
  "rennes",
  "washington",
  "washington dc",
  "geneve",
  "genève",
  "lyon",
  "bordeaux",
  "marseille",
];

function readLocationMatchTerms(locationLabel?: string | null) {
  return readTargetAiLocationMatchTerms(locationLabel);
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

function isChineseRestaurantNiche(niche: string) {
  const key = normalizeText(niche);
  return key.includes("chinois") || key.includes("chinese");
}

function isAsianRestaurantNiche(niche: string) {
  const key = normalizeText(niche);
  return key.includes("asiatique") || key.includes("asian");
}

function readTitleLocationHint(title: string | null | undefined) {
  const normalized = normalizeText(title);
  const parts = normalized.split("·").map((entry) => entry.trim()).filter(Boolean);
  if (parts.length <= 1) return null;
  return parts[parts.length - 1] || null;
}

function hasChineseFoodSignal(combined: string) {
  return includesAny(combined, [
    "chinese",
    "asian",
    "dim sum",
    "dumpling",
    "noodle",
    "ramen",
    "sushi",
    "halaal chinese",
    "wok",
    "cantonese",
  ]);
}

function scoreOffZonePenalty(input: {
  combined: string;
  title: string | null | undefined;
  locationLabel?: string | null;
}) {
  let penalty = 0;
  const titleText = normalizeText(input.title);
  const titleLocation = readTitleLocationHint(input.title);
  const hasLocalSignal = includesAny(input.combined, johannesburgLocalTerms);

  if (titleText) {
    for (const city of offZoneTitleCities) {
      if (includesTerm(titleText, city)) {
        penalty += 24;
      }
    }
  }

  if (titleLocation) {
    for (const city of offZoneTitleCities) {
      if (includesTerm(titleLocation, city)) {
        penalty += 22;
      }
    }
  }

  for (const foreignCity of readForeignCityPenalty(input.locationLabel)) {
    if (!includesTerm(input.combined, foreignCity)) continue;
    if (titleLocation && includesTerm(titleLocation, foreignCity)) {
      penalty += 16;
    } else if (!hasLocalSignal) {
      penalty += 12;
    } else {
      penalty += 5;
    }
  }

  return penalty;
}

function scoreChineseRestaurantRelevance(input: {
  combined: string;
  username: string;
  title: string | null | undefined;
  locHit: boolean;
  nicheHit: boolean;
  locationLabel?: string | null;
}) {
  let boost = 0;
  let penalty = 0;

  for (const term of chineseRestaurantBoostTerms) {
    if (includesTerm(input.combined, term)) boost += 5;
  }

  if (includesAny(input.combined, johannesburgLocalTerms)) boost += 4;
  if (input.locHit && input.nicheHit) boost += 10;
  if (includesTerm(input.username, "restaurant") || input.username.includes(".restaurant")) boost += 6;
  if (includesAny(input.username, ["dimsum", "dumpling", "chinese", "asian", "_jhb", "joburg"])) boost += 5;

  if (includesAny(input.combined, ["coffeehouse", "coffee house", "cafe"]) && !hasChineseFoodSignal(input.combined)) {
    penalty += 14;
  }

  for (const term of weakProfilePenaltyTerms) {
    if (includesTerm(input.combined, term)) penalty += 7;
  }

  if (includesAny(input.username, ["noms", "guide", "foodguide", "eater"])) penalty += 12;
  if (includesAny(input.username, ["basically", "coffeehouse", "coffee"])) penalty += 14;

  penalty += scoreOffZonePenalty({
    combined: input.combined,
    title: input.title,
    locationLabel: input.locationLabel,
  });

  return { boost, penalty };
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
    if (combined.includes(term)) score -= 10;
  }

  if (includesAny(combined, ["centre scolaire", "scolaire", "school", "university", "collège", "college"])) {
    score -= 14;
  }

  for (const foreignCity of readForeignCityPenalty(input.locationLabel)) {
    if (combined.includes(foreignCity) && !hasLocationHit(combined, input.candidate.sourceQuery, input.locationLabel)) {
      score -= 10;
    }
  }

  if (isChineseRestaurantNiche(input.niche) || isAsianRestaurantNiche(input.niche)) {
    const chineseScore = scoreChineseRestaurantRelevance({
      combined,
      username: normalizeText(input.candidate.username),
      title: input.candidate.title,
      locHit,
      nicheHit,
      locationLabel: input.locationLabel,
    });
    score += chineseScore.boost;
    score -= chineseScore.penalty;
  } else {
    score -= scoreOffZonePenalty({
      combined,
      title: input.candidate.title,
      locationLabel: input.locationLabel,
    });
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
