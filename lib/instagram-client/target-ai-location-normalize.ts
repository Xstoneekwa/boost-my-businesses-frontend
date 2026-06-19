import { parseTargetAiLocationParts, type TargetAiLocationParts } from "./target-ai-discovery-queries.ts";

export type TargetAiLocationKind = "city" | "country" | "region" | "unknown";

export type NormalizedTargetAiLocation = TargetAiLocationParts & {
  kind: TargetAiLocationKind;
  tokens: string[];
  rawLabel: string;
};

const CITY_DISTRICTS: Record<string, string[]> = {
  johannesburg: ["Sandton", "Rosebank", "Randburg", "Braamfontein", "Melville", "Fourways", "Melrose", "Norwood"],
  bordeaux: ["Mérignac", "Pessac", "Talence", "Bègles"],
  pretoria: ["Centurion", "Menlyn", "Brooklyn"],
};

const BELGIUM_COUNTRY_TOKENS = ["Belgique", "Belgium"] as const;

const BELGIUM_CITY_TOKENS = [
  "Bruxelles",
  "Brussels",
  "Antwerp",
  "Antwerpen",
  "Gent",
  "Ghent",
  "Liège",
  "Liege",
] as const;

const BELGIUM_ALIASES = new Set([
  "belgique",
  "belgium",
  "belgie",
  "belgien",
  "belgië",
]);

function normalizeKey(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function splitLabelSegments(label: string) {
  return label
    .split(/[/,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isBelgiumLabel(value: string) {
  const key = normalizeKey(value);
  if (BELGIUM_ALIASES.has(key)) return true;
  return splitLabelSegments(value).some((segment) => BELGIUM_ALIASES.has(normalizeKey(segment)));
}

function readCityDistricts(city: string | null) {
  if (!city) return [];
  return CITY_DISTRICTS[normalizeKey(city)] ?? [];
}

function pushToken(tokens: string[], seen: Set<string>, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  const key = normalizeKey(trimmed);
  if (seen.has(key)) return;
  seen.add(key);
  tokens.push(trimmed);
}

export function normalizeTargetAiLocation(locationLabel?: string | null): NormalizedTargetAiLocation {
  const rawLabel = locationLabel?.trim() || "";
  const parsed = parseTargetAiLocationParts(locationLabel);
  const tokens: string[] = [];
  const seen = new Set<string>();

  if (!rawLabel) {
    return {
      ...parsed,
      rawLabel,
      kind: "unknown",
      tokens: [],
    };
  }

  if (isBelgiumLabel(rawLabel) || isBelgiumLabel(parsed.city) || isBelgiumLabel(parsed.country || "")) {
    for (const countryToken of BELGIUM_COUNTRY_TOKENS) pushToken(tokens, seen, countryToken);
    for (const cityToken of BELGIUM_CITY_TOKENS) pushToken(tokens, seen, cityToken);
    return {
      label: rawLabel,
      city: parsed.city,
      region: parsed.region,
      country: parsed.country || "Belgique",
      rawLabel,
      kind: "country",
      tokens,
    };
  }

  const prioritized: string[] = [];
  const prioritySeen = new Set<string>();
  function pushPriority(value: string | null | undefined) {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = normalizeKey(trimmed);
    if (prioritySeen.has(key)) return;
    prioritySeen.add(key);
    prioritized.push(trimmed);
  }

  pushPriority(parsed.city);
  for (const district of readCityDistricts(parsed.city)) {
    pushPriority(district);
  }
  for (const segment of splitLabelSegments(rawLabel)) {
    pushPriority(segment);
  }
  pushPriority(parsed.region);
  pushPriority(parsed.country);

  const cityKey = normalizeKey(parsed.city);
  let kind: TargetAiLocationKind = "unknown";
  if (parsed.country && !parsed.region && splitLabelSegments(rawLabel).length <= 1 && cityKey === normalizeKey(parsed.country)) {
    kind = "country";
  } else if (parsed.region && !parsed.country) {
    kind = "region";
  } else if (parsed.city) {
    kind = "city";
  }

  return {
    ...parsed,
    rawLabel,
    kind,
    tokens: prioritized,
  };
}

export function readTargetAiLocationPhrases(locationLabel?: string | null) {
  const normalized = normalizeTargetAiLocation(locationLabel);
  return normalized.tokens;
}
