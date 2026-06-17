function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3);
}

function includesAny(haystack: string, needles: string[]) {
  if (!haystack) return false;
  return needles.some((needle) => haystack.includes(needle));
}

const foodKeywords = [
  "restaurant",
  "food",
  "kitchen",
  "chef",
  "bistro",
  "grill",
  "cafe",
  "bakery",
  "dining",
  "eatery",
  "chinese",
  "sushi",
  "pizza",
  "burger",
];

const mentalHealthKeywords = [
  "psych",
  "therapy",
  "therapist",
  "counsel",
  "mental",
  "psycholog",
  "wellness",
  "coach",
];

export function scoreTargetAiCandidateRelevance(input: {
  username: string;
  niche: string;
  locationLabel?: string | null;
  profileName?: string | null;
  biography?: string | null;
}) {
  const niche = normalizeText(input.niche);
  const location = normalizeText(input.locationLabel);
  const username = normalizeText(input.username);
  const profileName = normalizeText(input.profileName);
  const biography = normalizeText(input.biography);
  const combined = `${username} ${profileName} ${biography}`.trim();
  const nicheTokens = tokenize(niche);
  let score = 0;

  for (const token of nicheTokens) {
    if (username.includes(token)) score += 4;
    if (profileName.includes(token)) score += 3;
    if (biography.includes(token)) score += 2;
  }

  if (location) {
    const locationTokens = tokenize(location);
    for (const token of locationTokens) {
      if (combined.includes(token)) score += 3;
    }
    if (combined.includes(location)) score += 4;
  }

  if (includesAny(niche, ["food", "restaurant", "chinese", "kitchen", "chef", "bakery"])) {
    if (includesAny(combined, foodKeywords)) score += 4;
  }

  if (includesAny(niche, ["psych", "therapy", "mental", "coach", "counsel"])) {
    if (includesAny(combined, mentalHealthKeywords)) score += 4;
  }

  if (includesAny(combined, ["news", "media", "official", "government", "university"])) score -= 3;
  if (includesAny(username, ["shop", "store", "news", "tv", "media"])) score -= 2;

  return score;
}
