import { normalizeTargetAiLocation, type TargetAiLocationKind } from "./target-ai-location-normalize.ts";

export const BELGIUM_IN_LOCATION_MARKERS = [
  "belgique",
  "belgium",
  "belgië",
  "belgien",
  "belgie",
  "bruxelles",
  "brussels",
  "antwerp",
  "antwerpen",
  "anvers",
  "gent",
  "ghent",
  "gand",
  "liège",
  "liege",
  "luik",
  "charleroi",
  "watermael",
  "boitsfort",
  "flanders",
  "flandre",
  "wallonia",
  "wallonie",
  "belgian",
  "belge",
  ".be",
] as const;

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function includesTerm(haystack: string, term: string) {
  if (!term) return false;
  return haystack.includes(normalizeText(term));
}

function includesAny(haystack: string, terms: readonly string[]) {
  return terms.some((term) => includesTerm(haystack, term));
}

function isBelgiumLocation(locationLabel?: string | null) {
  const normalized = normalizeTargetAiLocation(locationLabel);
  if (normalized.kind === "country" && normalized.tokens.some((token) => {
    const key = normalizeText(token);
    return key === "belgique" || key === "belgium";
  })) {
    return true;
  }
  const label = normalizeText(locationLabel);
  return includesAny(label, ["belgique", "belgium", "belgië", "belgien", "belgie"]);
}

export function readTargetAiLocationKind(locationLabel?: string | null): TargetAiLocationKind {
  return normalizeTargetAiLocation(locationLabel).kind;
}

export function readTargetAiLocationMatchTerms(locationLabel?: string | null): string[] {
  const normalized = normalizeTargetAiLocation(locationLabel);
  const terms = new Set<string>();

  for (const token of normalized.tokens) {
    const value = normalizeText(token);
    if (value) terms.add(value);
  }

  if (normalized.city) terms.add(normalizeText(normalized.city));
  if (normalized.region) terms.add(normalizeText(normalized.region));
  if (normalized.country) terms.add(normalizeText(normalized.country));

  if (normalized.label) {
    for (const part of normalized.label.split(/[/,]/).map((entry) => entry.trim()).filter(Boolean)) {
      terms.add(normalizeText(part));
    }
  }

  if (isBelgiumLocation(locationLabel)) {
    for (const marker of BELGIUM_IN_LOCATION_MARKERS) terms.add(marker);
  }

  return [...terms].filter(Boolean);
}

export function hasTargetAiLocationHit(input: {
  combined: string;
  sourceQuery?: string | null;
  locationLabel?: string | null;
}) {
  const combined = normalizeText(input.combined);
  const sourceQuery = normalizeText(input.sourceQuery);
  const terms = readTargetAiLocationMatchTerms(input.locationLabel);

  if (terms.some((term) => includesTerm(combined, term))) return true;
  if (sourceQuery && terms.some((term) => includesTerm(sourceQuery, term))) return true;

  if (isBelgiumLocation(input.locationLabel)) {
    if (includesAny(combined, BELGIUM_IN_LOCATION_MARKERS)) return true;
    if (sourceQuery && includesAny(sourceQuery, ["belgique", "belgium", "bruxelles", "brussels", "antwerp", "antwerpen", "gent", "ghent", "liège", "liege"])) {
      return true;
    }
  }

  return false;
}

export function isCountryLevelTargetAiSearch(locationLabel?: string | null) {
  return readTargetAiLocationKind(locationLabel) === "country";
}
