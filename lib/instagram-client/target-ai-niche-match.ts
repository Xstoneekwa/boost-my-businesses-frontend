function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

export function readTargetAiNicheSynonyms(niche: string) {
  const normalized = normalizeText(niche);
  const phrases = new Set<string>([niche.trim()]);

  if (normalized.includes("restaurant") && normalized.includes("chinois")) {
    for (const term of [
      "restaurant chinois",
      "chinese restaurant",
      "chinese food",
      "chinese takeaway",
      "chinese cuisine",
      "dim sum",
      "dumplings",
      "noodles",
      "asian restaurant",
      "halaal chinese",
    ]) {
      phrases.add(term);
    }
  } else if (normalized.includes("restaurant") && normalized.includes("asiatique")) {
    for (const term of [
      "restaurant asiatique",
      "restaurant chinois",
      "restaurant japonais",
      "ramen",
      "sushi",
      "asian restaurant",
    ]) {
      phrases.add(term);
    }
  } else if (normalized.includes("psycholog")) {
    for (const term of [
      "psychologue",
      "psychologist",
      "clinical psychologist",
      "therapy",
      "therapist",
      "counselling",
      "mental health",
    ]) {
      phrases.add(term);
    }
  } else if (normalized.includes("social media") || normalized.includes("agence")) {
    for (const term of [
      "agence social media",
      "social media agency",
      "digital agency",
      "marketing agency",
      "community management",
      "agence digitale",
      "agence marketing",
    ]) {
      phrases.add(term);
    }
  }

  return [...phrases];
}

export function readTargetAiNicheMatchTerms(niche: string) {
  const terms = new Set<string>(readTargetAiNicheSynonyms(niche));
  for (const token of normalizeText(niche).split(/[^a-z0-9]+/g).filter((entry) => entry.length >= 4)) {
    terms.add(token);
  }
  return [...terms];
}

export function combinedTextMatchesNiche(combined: string, niche: string) {
  const haystack = normalizeText(combined);
  return readTargetAiNicheMatchTerms(niche).some((term) => haystack.includes(normalizeText(term)));
}
