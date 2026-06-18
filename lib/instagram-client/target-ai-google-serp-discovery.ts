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
  pagesFetched: number;
  organicResultsScanned: number;
  extractedCandidatesCount: number;
  stoppedReason: string | null;
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

async function fetchSearchApiPage(input: {
  query: string;
  page: number;
  fetcher?: typeof fetch;
  timeoutMs: number;
}) {
  const apiKey = readDiscoveryApiKey();
  const endpoint = readDiscoveryEndpoint();
  const url = new URL(endpoint);
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", input.query);
  url.searchParams.set("api_key", apiKey);
  if (input.page > 1) url.searchParams.set("page", String(input.page));

  return runSearchApiThrottledFetch(
    `google-serp:${input.query.slice(0, 48)}:p${input.page}`,
    url.toString(),
    {
      fetcher: input.fetcher,
      timeoutMs: input.timeoutMs,
    },
  );
}

export async function runTargetAiGoogleSerpDiscovery(input: {
  queries: string[];
  maxCandidates?: number;
  pagesPerQuery?: number;
  maxDurationMs?: number;
  pageDelayMs?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<TargetAiGoogleSerpDiscoveryResult> {
  const apiKey = readDiscoveryApiKey();
  const endpoint = readDiscoveryEndpoint();
  const queries = input.queries.filter(Boolean);
  const maxCandidates = input.maxCandidates ?? 80;
  const pagesPerQuery = Math.min(Math.max(input.pagesPerQuery ?? 3, 1), 4);
  const maxDurationMs = input.maxDurationMs ?? 75_000;
  const pageDelayMs = input.pageDelayMs ?? 350;
  const timeoutMs = input.timeoutMs ?? 10_000;
  const startedAt = Date.now();

  if (!apiKey || !endpoint || queries.length === 0) {
    return {
      candidates: [],
      queriesExecuted: 0,
      queriesSucceeded: 0,
      queriesFailed: 0,
      pagesFetched: 0,
      organicResultsScanned: 0,
      extractedCandidatesCount: 0,
      stoppedReason: "discovery_not_configured",
    };
  }

  let queriesExecuted = 0;
  let queriesSucceeded = 0;
  let queriesFailed = 0;
  let pagesFetched = 0;
  let organicResultsScanned = 0;
  let stoppedReason: string | null = null;
  const collected: SerpProfileCandidate[] = [];

  for (const query of queries) {
    if (collected.length >= maxCandidates) {
      stoppedReason = "candidate_cap_reached";
      break;
    }
    if (Date.now() - startedAt >= maxDurationMs) {
      stoppedReason = "time_budget_reached";
      break;
    }

    queriesExecuted += 1;
    const organicByLink = new Map<string, SerpOrganicRow>();
    let querySucceeded = false;

    for (let page = 1; page <= pagesPerQuery; page += 1) {
      if (Date.now() - startedAt >= maxDurationMs) {
        stoppedReason = "time_budget_reached";
        break;
      }
      if (collected.length >= maxCandidates) break;

      pagesFetched += 1;
      const response = await fetchSearchApiPage({ query, page, fetcher: input.fetcher, timeoutMs });
      if (!response.ok) {
        if (page === 1) queriesFailed += 1;
        break;
      }

      querySucceeded = true;
      for (const row of readOrganicResults(response.payload)) {
        const key = (row.link || row.displayed_link || "").trim().toLowerCase();
        if (!key || organicByLink.has(key)) continue;
        organicByLink.set(key, row);
      }

      if (page < pagesPerQuery) {
        await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
      }
    }

    if (querySucceeded) {
      queriesSucceeded += 1;
      const organicResults = [...organicByLink.values()];
      organicResultsScanned += organicResults.length;
      collected.push(...extractSerpProfilesFromOrganicResults({ rows: organicResults, sourceQuery: query }));
    }
  }

  const candidates = dedupeSerpProfileCandidates(collected, maxCandidates);
  return {
    candidates,
    queriesExecuted,
    queriesSucceeded,
    queriesFailed,
    pagesFetched,
    organicResultsScanned,
    extractedCandidatesCount: candidates.length,
    stoppedReason: stoppedReason ?? (candidates.length > 0 ? "completed" : "insufficient_candidates"),
  };
}
