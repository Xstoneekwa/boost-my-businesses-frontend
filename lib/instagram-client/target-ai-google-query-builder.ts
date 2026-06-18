import { parseTargetAiLocationParts } from "./target-ai-discovery-queries.ts";
import { readTargetAiNicheSynonyms } from "./target-ai-niche-match.ts";

export const TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS_SHORT = [
  "-inurl:/p/",
  "-inurl:/explore",
] as const;

export const TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS = [
  ...TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS_SHORT,
  "-inurl:/reel/",
  "-inurl:/stories",
  "-inurl:/tv/",
  "-inurl:/direct/",
  "-inurl:/accounts/",
] as const;

const CITY_DISTRICTS: Record<string, string[]> = {
  johannesburg: ["Sandton", "Rosebank", "Randburg", "Braamfontein", "Melville"],
  bordeaux: ["Mérignac", "Pessac", "Talence", "Bègles"],
  pretoria: ["Centurion", "Menlyn", "Brooklyn"],
};

const COUNTRY_MAJOR_CITIES: Record<string, string[]> = {
  belgique: ["Belgium", "Bruxelles", "Brussels", "Antwerp", "Gent", "Ghent", "Liège"],
  belgium: ["Belgique", "Bruxelles", "Brussels", "Antwerp", "Gent", "Ghent", "Liège"],
};

function normalizeKey(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function readLooseNicheVariants(niche: string) {
  return readTargetAiNicheSynonyms(niche);
}

function readLocationPhrases(locationLabel?: string | null) {
  const location = parseTargetAiLocationParts(locationLabel);
  const phrases: string[] = [];
  const seen = new Set<string>();

  function push(value: string | null | undefined) {
    const trimmed = value?.trim();
    if (!trimmed) return;
    const key = normalizeKey(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    phrases.push(trimmed);
  }

  push(location.city);
  if (location.city) {
    for (const district of CITY_DISTRICTS[normalizeKey(location.city)] ?? []) {
      push(district);
    }
  }
  push(location.region);
  push(location.country);
  push(location.label);

  const countryKey = normalizeKey(location.country || location.city || location.label);
  for (const city of COUNTRY_MAJOR_CITIES[countryKey] ?? []) {
    push(city);
  }

  return phrases;
}

function buildLooseInstagramQuery(locationPhrase: string, nichePhrase: string) {
  return `"${locationPhrase}" "${nichePhrase}" instagram`;
}

function buildStrictInstagramQuery(input: {
  locationPhrase: string;
  nichePhrase: string;
  includeSiteInternet?: boolean;
}) {
  const parts = [`"${input.locationPhrase}"`, `"${input.nichePhrase}"`];
  if (input.includeSiteInternet) parts.push('"site internet"');
  parts.push("site:instagram.com");
  parts.push(...TARGET_AI_GOOGLE_INSTAGRAM_EXCLUSIONS_SHORT);
  return parts.join(" ");
}

export function buildTargetAiLooseQueries(input: {
  niche: string;
  locationLabel?: string | null;
  maxQueries?: number;
}) {
  const maxQueries = input.maxQueries ?? 24;
  const nicheVariants = readLooseNicheVariants(input.niche);
  const locationPhrases = readLocationPhrases(input.locationLabel);
  const seen = new Set<string>();
  const output: string[] = [];

  function push(query: string) {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  }

  const primaryVariants = nicheVariants.slice(0, 6);

  for (const locationPhrase of locationPhrases) {
    for (const nichePhrase of primaryVariants.slice(0, locationPhrase === locationPhrases[0] ? primaryVariants.length : 3)) {
      push(buildLooseInstagramQuery(locationPhrase, nichePhrase));
    }
  }

  return output.slice(0, maxQueries);
}

export function buildTargetAiStrictComplementQueries(input: {
  niche: string;
  locationLabel?: string | null;
  maxQueries?: number;
}) {
  const maxQueries = input.maxQueries ?? 4;
  const location = parseTargetAiLocationParts(input.locationLabel);
  const primaryLocation = location.city || location.label;
  const nicheVariants = readLooseNicheVariants(input.niche).slice(0, 3);
  const seen = new Set<string>();
  const output: string[] = [];

  function push(query: string) {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  }

  if (!primaryLocation) return output;

  for (const nichePhrase of nicheVariants) {
    push(buildStrictInstagramQuery({ locationPhrase: primaryLocation, nichePhrase, includeSiteInternet: true }));
    push(buildStrictInstagramQuery({ locationPhrase: primaryLocation, nichePhrase, includeSiteInternet: false }));
  }

  return output.slice(0, maxQueries);
}

export function buildTargetAiGoogleQueries(input: {
  niche: string;
  locationLabel?: string | null;
  maxQueries?: number;
  maxStrictQueries?: number;
}) {
  const maxQueries = input.maxQueries ?? 24;
  const maxStrictQueries = input.maxStrictQueries ?? 4;
  const looseBudget = Math.max(maxQueries - maxStrictQueries, Math.floor(maxQueries * 0.75));

  const loose = buildTargetAiLooseQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
    maxQueries: looseBudget,
  });
  const strict = buildTargetAiStrictComplementQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
    maxQueries: maxStrictQueries,
  });

  const seen = new Set<string>();
  const output: string[] = [];
  for (const query of [...loose, ...strict]) {
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(query);
    if (output.length >= maxQueries) break;
  }
  return output;
}

export function buildTargetAiManualBenchmarkQueries(input: {
  niche: string;
  locationLabel?: string | null;
}) {
  return {
    strict: buildTargetAiStrictComplementQueries({
      niche: input.niche,
      locationLabel: input.locationLabel,
      maxQueries: 4,
    }),
    loose: buildTargetAiLooseQueries({
      niche: input.niche,
      locationLabel: input.locationLabel,
      maxQueries: 16,
    }),
  };
}

export function formatTargetAiGoogleQueryExample(input: {
  niche: string;
  locationLabel?: string | null;
}) {
  return buildTargetAiGoogleQueries({ ...input, maxQueries: 6 });
}
