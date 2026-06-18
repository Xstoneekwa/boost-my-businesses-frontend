import { runSearchApiThrottledFetch } from "../instagram-public-profile-lookup.ts";
import {
  dedupeSerpProfileCandidates,
  extractSerpProfilesFromOrganicResults,
  type SerpOrganicRow,
  type SerpProfileCandidate,
} from "./target-ai-serp-extractor.ts";

export type TargetAiGoogleSerpDiscoveryStats = {
  queriesExecuted: number;
  queriesSucceeded: number;
  queriesFailed: number;
  organicResultsScanned: number;
  extractedCandidatesCount: number;
};

export type TargetAiGoogleSerpDiscoveryResult = TargetAiGoogleSerpDiscoveryStats & {
  candidates: SerpProfileCandidate[];
};

function readDiscoveryEndpoint() {
  return process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL?.trim()
    || process.env.TARGET_AI_DISCOVERY_SEARCH_URL?.trim()
    || "https://www.searchapi.io/api/v1/search";
}

function readDiscoveryApiKey() {
  return process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim()
    || process.env.TARGET_AI_SEARCHAPI_KEY?.trim()
    || "";
}

export function isTargetAiGoogleSerpDiscoveryConfigured() {
  return Boolean(readDiscoveryApiKey());
}

function readOrganicResults(payload: unknown): SerpOrganicRow[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  for (const entry of [record.organic_results, record.results, record.items]) {
    if (!Array.isArray(entry)) continue;
    return entry.filter((row) => row && typeof row === "object") as SerpOrganicRow[];
  }
  return [];
}

export async function runTargetAiGoogleSerpDiscovery(input: {
  queries: string[];
  maxCandidates?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<TargetAiGoogleSerpDiscoveryResult> {
  const apiKey = readDiscoveryApiKey();
  const endpoint = readDiscoveryEndpoint();
  const queries = input.queries.filter(Boolean);
  const maxCandidates = input.maxCandidates ?? 80;

  if (!apiKey || queries.length === 0) {
    return {
      candidates: [],
      queriesExecuted: 0,
      queriesSucceeded: 0,
      queriesFailed: 0,
      organicResultsScanned: 0,
      extractedCandidatesCount: 0,
    };
  }

  let queriesExecuted = 0;
  let queriesSucceeded = 0;
  let queriesFailed = 0;
  let organicResultsScanned = 0;
  const collected: SerpProfileCandidate[] = [];

  for (const query of queries) {
    if (collected.length >= maxCandidates) break;
    queriesExecuted += 1;
    const url = new URL(endpoint);
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("api_key", apiKey);

    const response = await runSearchApiThrottledFetch(`google-serp:${query.slice(0, 48)}`, url.toString(), {
      fetcher: input.fetcher,
      timeoutMs: input.timeoutMs ?? 8000,
    });

    if (!response.ok) {
      queriesFailed += 1;
      continue;
    }

    queriesSucceeded += 1;
    const organicResults = readOrganicResults(response.payload);
    organicResultsScanned += organicResults.length;
    collected.push(...extractSerpProfilesFromOrganicResults({ rows: organicResults, sourceQuery: query }));
  }

  const candidates = dedupeSerpProfileCandidates(collected, maxCandidates);
  return {
    candidates,
    queriesExecuted,
    queriesSucceeded,
    queriesFailed,
    organicResultsScanned,
    extractedCandidatesCount: candidates.length,
  };
}
