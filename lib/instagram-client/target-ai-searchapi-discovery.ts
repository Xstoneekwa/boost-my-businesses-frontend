import { runSearchApiThrottledFetch } from "../instagram-public-profile-lookup.ts";
import { extractInstagramUsernamesFromSearchResult, mergeDiscoveredUsernames } from "./target-ai-instagram-url.ts";
import type { TargetAiSearchRuntime } from "./target-ai-search-runtime.ts";

export type DiscoveredInstagramCandidate = {
  username: string;
  sourceQuery: string;
  title: string | null;
  snippet: string | null;
};

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
  candidates: DiscoveredInstagramCandidate[];
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

export function isTargetAiSearchApiDiscoveryConfigured() {
  return Boolean(readDiscoveryApiKey());
}

function readOrganicResults(payload: unknown): SearchApiOrganicResult[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  for (const entry of [record.organic_results, record.results, record.items]) {
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
  runtime?: TargetAiSearchRuntime;
}) {
  if (input.runtime) {
    await input.runtime.waitForCooldown();
    if (input.runtime.isTimeExceeded()) return { ok: false as const, status: 0, payload: null, reason: "time_budget" };
  }

  const url = new URL(input.endpoint);
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", input.query);
  url.searchParams.set("api_key", input.apiKey);
  if (input.page > 1) url.searchParams.set("page", String(input.page));

  const scopeKey = `discovery:${input.query.slice(0, 40)}:${input.page}`;
  const response = await runSearchApiThrottledFetch(scopeKey, url.toString(), {
    fetcher: input.fetcher,
    timeoutMs: input.timeoutMs ?? 7000,
  });

  if (!response.ok && (response.reason === "rate_limited" || response.reason === "provider_throttled")) {
    input.runtime?.recordRateLimit();
  }

  return response;
}

export async function discoverInstagramUsernamesViaSearchApi(input: {
  queries: string[];
  maxUsernames: number;
  maxPagesPerQuery?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  runtime?: TargetAiSearchRuntime;
}): Promise<TargetAiSearchApiDiscoveryResult> {
  const apiKey = readDiscoveryApiKey();
  const endpoint = readDiscoveryEndpoint();
  const queries = input.queries.filter(Boolean);
  const maxPagesPerQuery = input.maxPagesPerQuery ?? 1;

  if (!apiKey || queries.length === 0) {
    return {
      usernames: [],
      candidates: [],
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
  const discovered: DiscoveredInstagramCandidate[] = [];
  const seenUsernames = new Set<string>();

  for (const query of queries) {
    if (input.runtime?.isTimeExceeded()) break;
    if (input.runtime?.shouldPauseDiscovery()) break;
    if (seenUsernames.size >= input.maxUsernames) break;

    for (let page = 1; page <= maxPagesPerQuery; page += 1) {
      if (seenUsernames.size >= input.maxUsernames) break;
      queriesExecuted += 1;
      const response = await fetchDiscoveryQuery({
        query,
        page,
        apiKey,
        endpoint,
        fetcher: input.fetcher,
        timeoutMs: input.timeoutMs,
        runtime: input.runtime,
      });
      if (!response.ok) {
        queriesFailed += 1;
        if (page === 1) break;
        continue;
      }
      const organicResults = readOrganicResults(response.payload);
      organicResultsScanned += organicResults.length;
      for (const row of organicResults) {
        const usernames = extractInstagramUsernamesFromSearchResult(row);
        for (const username of usernames) {
          if (seenUsernames.has(username)) continue;
          seenUsernames.add(username);
          discovered.push({
            username,
            sourceQuery: query,
            title: row.title ?? null,
            snippet: row.snippet ?? null,
          });
          if (discovered.length >= input.maxUsernames) break;
        }
      }
      if (page === 1) queriesSucceeded += 1;
      if (organicResults.length < 4) break;
    }
  }

  const merged = mergeDiscoveredUsernames([discovered.map((row) => row.username)], input.maxUsernames);
  const candidateByUsername = new Map(discovered.map((row) => [row.username, row]));

  return {
    usernames: merged.usernames,
    candidates: merged.usernames
      .map((username) => candidateByUsername.get(username))
      .filter((row): row is DiscoveredInstagramCandidate => Boolean(row)),
    queriesExecuted,
    queriesSucceeded,
    queriesFailed,
    organicResultsScanned,
    extractedUsernamesCount: merged.usernames.length,
    duplicateSkippedCount: merged.duplicateSkipped,
  };
}
