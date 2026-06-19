import {
  dedupeSerpProfileCandidates,
  extractSerpProfilesFromOrganicResults,
  summarizeSerpExtractionFromOrganicResults,
  type SerpOrganicRow,
  type SerpProfileCandidate,
} from "./target-ai-serp-extractor.ts";

export type TargetAiGoogleSerpDiscoveryStats = {
  queriesExecuted: number;
  queriesSucceeded: number;
  queriesFailed: number;
  queriesThrottled: number;
  pagesFetched: number;
  organicResultsScanned: number;
  extractedCandidatesCount: number;
  strictExtractedCount: number;
  looseExtractedCount: number;
  rejectedNonProfileCount: number;
  rejectionsByReason: Record<string, number>;
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

  const fetcher = input.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetcher(url.toString(), {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 429) {
      return { ok: false as const, status: 429, payload: null, reason: "rate_limited" };
    }
    if (!response.ok) {
      return { ok: false as const, status: response.status, payload: null, reason: `provider_http_${response.status}` };
    }
    return { ok: true as const, status: response.status, payload: await response.json(), reason: "ok" };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_error";
    return { ok: false as const, status: 0, payload: null, reason };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runTargetAiGoogleSerpDiscovery(input: {
  queries: string[];
  maxCandidates?: number;
  pagesPerQuery?: number;
  maxDurationMs?: number;
  pageDelayMs?: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  earlyStopCandidateCount?: number;
  maxQueriesToExecute?: number;
  thirdPageMinCandidates?: number;
}): Promise<TargetAiGoogleSerpDiscoveryResult> {
  const apiKey = readDiscoveryApiKey();
  const endpoint = readDiscoveryEndpoint();
  const queries = input.queries.filter(Boolean);
  const executableQueries = queries.slice(0, input.maxQueriesToExecute ?? queries.length);
  const maxCandidates = input.maxCandidates ?? 80;
  const earlyStopCandidateCount = input.earlyStopCandidateCount ?? maxCandidates;
  const pagesPerQueryCap = Math.min(Math.max(input.pagesPerQuery ?? 2, 1), 4);
  const thirdPageMinCandidates = input.thirdPageMinCandidates ?? 25;
  const maxDurationMs = input.maxDurationMs
    ?? Math.min(Math.max(executableQueries.length * pagesPerQueryCap * 2_500, 60_000), 120_000);
  const pageDelayMs = input.pageDelayMs ?? 280;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const startedAt = Date.now();

  if (!apiKey || !endpoint || executableQueries.length === 0) {
    return {
      candidates: [],
      queriesExecuted: 0,
      queriesSucceeded: 0,
      queriesFailed: 0,
      queriesThrottled: 0,
      pagesFetched: 0,
      organicResultsScanned: 0,
      extractedCandidatesCount: 0,
      strictExtractedCount: 0,
      looseExtractedCount: 0,
      rejectedNonProfileCount: 0,
      rejectionsByReason: {},
      stoppedReason: "discovery_not_configured",
    };
  }

  let queriesExecuted = 0;
  let queriesSucceeded = 0;
  let queriesFailed = 0;
  let queriesThrottled = 0;
  let pagesFetched = 0;
  let organicResultsScanned = 0;
  let strictExtractedCount = 0;
  let looseExtractedCount = 0;
  let rejectedNonProfileCount = 0;
  const rejectionsByReason: Record<string, number> = {};
  let stoppedReason: string | null = null;
  const collected: SerpProfileCandidate[] = [];

  for (const query of executableQueries) {
    if (collected.length >= maxCandidates) {
      stoppedReason = "candidate_cap_reached";
      break;
    }
    if (collected.length >= earlyStopCandidateCount) {
      stoppedReason = "enough_candidates";
      break;
    }
    if (Date.now() - startedAt >= maxDurationMs) {
      stoppedReason = "time_budget_reached";
      break;
    }

    queriesExecuted += 1;
    const organicByLink = new Map<string, SerpOrganicRow>();
    let querySucceeded = false;
    const pagesForQuery = collected.length < thirdPageMinCandidates
      ? Math.min(pagesPerQueryCap, 3)
      : Math.min(pagesPerQueryCap, 2);

    for (let page = 1; page <= pagesForQuery; page += 1) {
      if (Date.now() - startedAt >= maxDurationMs) {
        stoppedReason = "time_budget_reached";
        break;
      }
      if (collected.length >= maxCandidates || collected.length >= earlyStopCandidateCount) break;

      pagesFetched += 1;
      const response = await fetchSearchApiPage({ query, page, fetcher: input.fetcher, timeoutMs });
      if (!response.ok) {
        if (page === 1) queriesFailed += 1;
        if (response.reason?.includes("thrott") || response.reason?.includes("rate")) queriesThrottled += 1;
        break;
      }

      querySucceeded = true;
      for (const row of readOrganicResults(response.payload)) {
        const key = (row.link || row.displayed_link || "").trim().toLowerCase();
        if (!key || organicByLink.has(key)) continue;
        organicByLink.set(key, row);
      }

      if (page < pagesForQuery) {
        await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
      }
    }

    if (querySucceeded) {
      queriesSucceeded += 1;
      const organicResults = [...organicByLink.values()];
      organicResultsScanned += organicResults.length;
      const extractionStats = summarizeSerpExtractionFromOrganicResults({
        rows: organicResults,
        sourceQuery: query,
      });
      strictExtractedCount += extractionStats.strict_extracted;
      looseExtractedCount += extractionStats.loose_extracted;
      rejectedNonProfileCount += extractionStats.rejected_non_profile;
      for (const [reason, count] of Object.entries(extractionStats.rejections_by_reason)) {
        rejectionsByReason[reason] = (rejectionsByReason[reason] || 0) + count;
      }
      collected.push(...extractSerpProfilesFromOrganicResults({ rows: organicResults, sourceQuery: query }));
    }

    if (collected.length >= earlyStopCandidateCount) {
      stoppedReason = "enough_candidates";
      break;
    }
    if (collected.length >= maxCandidates) {
      stoppedReason = "candidate_cap_reached";
      break;
    }
    if (stoppedReason === "time_budget_reached") break;
  }

  const candidates = dedupeSerpProfileCandidates(collected, maxCandidates);
  return {
    candidates,
    queriesExecuted,
    queriesSucceeded,
    queriesFailed,
    queriesThrottled,
    pagesFetched,
    organicResultsScanned,
    extractedCandidatesCount: candidates.length,
    strictExtractedCount,
    looseExtractedCount,
    rejectedNonProfileCount,
    rejectionsByReason,
    stoppedReason: stoppedReason ?? (candidates.length > 0 ? "completed" : "insufficient_candidates"),
  };
}
