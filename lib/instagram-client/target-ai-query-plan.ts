import {
  buildTargetAiGoogleQueries,
  buildTargetAiLooseQueries,
  buildTargetAiStrictComplementQueries,
} from "./target-ai-google-query-builder.ts";
import { readTargetAiNicheSynonyms } from "./target-ai-niche-match.ts";
import { normalizeTargetAiLocation } from "./target-ai-location-normalize.ts";

function readIntEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildTargetAiRuntimeQueryPlan(input: {
  niche: string;
  locationLabel?: string | null;
  maxQueries?: number;
}) {
  const maxQueries = input.maxQueries ?? readIntEnv("TARGET_AI_V2_MAX_GOOGLE_QUERIES", 24);
  const pagesPerQuery = readIntEnv("TARGET_AI_V2_SERP_PAGES", 3);
  const normalizedLocation = normalizeTargetAiLocation(input.locationLabel);
  const looseQueries = buildTargetAiLooseQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
    maxQueries: Math.max(maxQueries - 4, Math.floor(maxQueries * 0.75)),
  });
  const strictQueries = buildTargetAiStrictComplementQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
    maxQueries: 4,
  });
  const queries = buildTargetAiGoogleQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
    maxQueries,
  });

  return {
    normalizedLocation: normalizedLocation.rawLabel,
    locationKind: normalizedLocation.kind,
    locationTokens: normalizedLocation.tokens,
    nicheTokens: readTargetAiNicheSynonyms(input.niche),
    loose_queries_count: looseQueries.length,
    strict_queries_count: strictQueries.length,
    total_queries_count: queries.length,
    pages_per_query: pagesPerQuery,
    max_queries_cap: maxQueries,
    env_TARGET_AI_V2_SERP_PAGES: pagesPerQuery,
    env_TARGET_AI_V2_MAX_GOOGLE_QUERIES: maxQueries,
    first_20_queries: queries.slice(0, 20),
    queries,
  };
}
