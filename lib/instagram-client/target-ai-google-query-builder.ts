import { readTargetAiLocationPhrases } from "./target-ai-location-normalize.ts";
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

function readLooseNicheVariants(niche: string) {
  return readTargetAiNicheSynonyms(niche);
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
  const locationPhrases = readTargetAiLocationPhrases(input.locationLabel);
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

  if (locationPhrases.length === 0) {
    for (const nichePhrase of nicheVariants.slice(0, 6)) {
      push(`"${nichePhrase}" instagram`);
    }
    return output.slice(0, maxQueries);
  }

  const primaryVariants = nicheVariants.slice(0, 6);
  for (const locationPhrase of locationPhrases) {
    const variantLimit = locationPhrase === locationPhrases[0] ? primaryVariants.length : 3;
    for (const nichePhrase of primaryVariants.slice(0, variantLimit)) {
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
  const locationPhrases = readTargetAiLocationPhrases(input.locationLabel);
  const primaryLocation = locationPhrases[0];
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
