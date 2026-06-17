import { mapWithConcurrency } from "../instagram-dashboard/target-provider-enrichment.ts";
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
    maxDiscoveryQueries: readIntEnv("TARGET_AI_MAX_DISCOVERY_QUERIES", 16, 8, 20),
    maxDiscoveredUsernames: readIntEnv("TARGET_AI_MAX_DISCOVERED_USERNAMES", 80, 20, 80),
    discoveryConcurrency: readIntEnv("TARGET_AI_DISCOVERY_CONCURRENCY", 3, 1, 4),
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

export async function discoverInstagramUsernamesViaSearchApi(input: {
  queries: string[];
  maxUsernames: number;
  concurrency?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<TargetAiSearchApiDiscoveryResult> {
  const apiKey = readDiscoveryApiKey();
  const endpoint = readDiscoveryEndpoint();
  const fetcher = input.fetcher ?? fetch;
  const concurrency = input.concurrency ?? readTargetAiDiscoveryLimits().discoveryConcurrency;
  const queries = input.queries.filter(Boolean).slice(0, readTargetAiDiscoveryLimits().maxDiscoveryQueries);

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
  const usernameBatches: string[][] = [];

  await mapWithConcurrency(queries, concurrency, async (query) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 8000);
    try {
      const url = new URL(endpoint);
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", query);
      url.searchParams.set("api_key", apiKey);
      const response = await fetcher(url.toString(), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        queriesFailed += 1;
        return;
      }
      const payload = await response.json();
      const organicResults = readOrganicResults(payload);
      organicResultsScanned += organicResults.length;
      const extracted: string[] = [];
      for (const row of organicResults) {
        extracted.push(...extractInstagramUsernamesFromSearchResult(row));
      }
      if (extracted.length > 0) usernameBatches.push(extracted);
      queriesSucceeded += 1;
    } catch {
      queriesFailed += 1;
    } finally {
      clearTimeout(timeout);
    }
  });

  const merged = mergeDiscoveredUsernames(usernameBatches, input.maxUsernames);

  return {
    usernames: merged.usernames,
    queriesExecuted: queries.length,
    queriesSucceeded,
    queriesFailed,
    organicResultsScanned,
    extractedUsernamesCount: merged.usernames.length,
    duplicateSkippedCount: merged.duplicateSkipped,
  };
}
