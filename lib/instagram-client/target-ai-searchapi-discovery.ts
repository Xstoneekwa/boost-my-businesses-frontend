import { runSearchApiThrottledFetch } from "../instagram-public-profile-lookup.ts";
import { extractInstagramUsernamesFromSearchResult, mergeDiscoveredUsernames } from "./target-ai-instagram-url.ts";

export type TargetAiSearchApiDiscoveryStats = {
  queriesExecuted: number;
  queriesSucceeded: number;
  queriesFailed: number;
  organicResultsScanned: number;
  extractedUsernamesCount: number;
  duplicateSkippedCount: number;
};

export type TargetAiSearchApiDiscoveryResult = TargetAiSearchApiDiscoveryStats & {
  usernames: string[];
};

type SearchApiOrganicResult = {
  link?: string | null;
  title?: string | null;
  snippet?: string | null;
  displayed_link?: string | null;
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

function readIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function readTargetAiDiscoveryLimits() {
  return {
    maxDiscoveryQueries: readIntEnv("TARGET_AI_MAX_DISCOVERY_QUERIES", 18, 8, 24),
    maxDiscoveredUsernames: readIntEnv("TARGET_AI_MAX_DISCOVERED_USERNAMES", 100, 20, 120),
    discoveryConcurrency: readIntEnv("TARGET_AI_DISCOVERY_CONCURRENCY", 2, 1, 3),
  };
}

export function isTargetAiSearchApiDiscoveryConfigured() {
  return Boolean(readDiscoveryApiKey());
}

function readOrganicResults(payload: unknown): SearchApiOrganicResult[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.organic_results,
    record.results,
    record.items,
  ];
  for (const entry of candidates) {
    if (!Array.isArray(entry)) continue;
    return entry.filter((row) => row && typeof row === "object") as SearchApiOrganicResult[];
  }
  return [];
}

async function fetchDiscoveryQuery(input: {
  query: string;
  page: number;
  apiKey: string;
  endpoint: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  const url = new URL(input.endpoint);
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", input.query);
  url.searchParams.set("api_key", input.apiKey);
  if (input.page > 1) url.searchParams.set("page", String(input.page));

  const scopeKey = `discovery:${input.query.slice(0, 40)}:${input.page}`;
  return runSearchApiThrottledFetch(scopeKey, url.toString(), {
    fetcher: input.fetcher,
    timeoutMs: input.timeoutMs ?? 8000,
  });
}

export async function discoverInstagramUsernamesViaSearchApi(input: {
  queries: string[];
  maxUsernames: number;
  concurrency?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<TargetAiSearchApiDiscoveryResult> {
  const apiKey = readDiscoveryApiKey();
  const endpoint = readDiscoveryEndpoint();
  const limits = readTargetAiDiscoveryLimits();
  const queries = input.queries.filter(Boolean).slice(0, limits.maxDiscoveryQueries);

  if (!apiKey || queries.length === 0) {
    return {
      usernames: [],
      queriesExecuted: 0,
      queriesSucceeded: 0,
      queriesFailed: 0,
      organicResultsScanned: 0,
      extractedUsernamesCount: 0,
      duplicateSkippedCount: 0,
    };
  }

  let queriesSucceeded = 0;
  let queriesFailed = 0;
  let organicResultsScanned = 0;
  let queriesExecuted = 0;
  const usernameBatches: string[][] = [];

  for (const query of queries) {
    for (const page of [1, 2]) {
      if (usernameBatches.flat().length >= input.maxUsernames) break;
      queriesExecuted += 1;
      const response = await fetchDiscoveryQuery({
        query,
        page,
        apiKey,
        endpoint,
        fetcher: input.fetcher,
        timeoutMs: input.timeoutMs,
      });
      if (!response.ok) {
        queriesFailed += 1;
        if (page === 1) break;
        continue;
      }
      const organicResults = readOrganicResults(response.payload);
      if (organicResults.length === 0 && page === 2) continue;
      organicResultsScanned += organicResults.length;
      const extracted: string[] = [];
      for (const row of organicResults) {
        extracted.push(...extractInstagramUsernamesFromSearchResult(row));
      }
      if (extracted.length > 0) usernameBatches.push(extracted);
      if (page === 1) queriesSucceeded += 1;
      if (organicResults.length < 4) break;
    }
  }

  const merged = mergeDiscoveredUsernames(usernameBatches, input.maxUsernames);

  return {
    usernames: merged.usernames,
    queriesExecuted,
    queriesSucceeded,
    queriesFailed,
    organicResultsScanned,
    extractedUsernamesCount: merged.usernames.length,
    duplicateSkippedCount: merged.duplicateSkipped,
  };
}
