import { runTargetAiGoogleSerpDiscovery } from "@/lib/instagram-client/target-ai-google-serp-discovery";
import type { CommercialDiscoveryCity, CommercialDiscoverySubsegment } from "./discovery-contract";
import { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio";

export { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio";

export type CommercialDiscoveryCandidate = {
  provider: "searchapi";
  providerExternalId: string;
  instagramHandle: string;
  profileUrl: string;
  title: string | null;
  snippet: string | null;
  sourceQuery: string;
  position: number;
  extractionMode: "strict" | "loose";
};

export type CommercialDiscoveryProviderResult = {
  candidates: CommercialDiscoveryCandidate[];
  queries: string[];
  diagnostic: Record<string, unknown>;
};

export async function discoverCommercialCandidates(input: { city: CommercialDiscoveryCity; subsegment?: CommercialDiscoverySubsegment; maxCandidates: number; fetcher?: typeof fetch }): Promise<CommercialDiscoveryProviderResult> {
  const queries = buildCommercialDiscoveryQueries(input.city, input.subsegment);
  const result = await runTargetAiGoogleSerpDiscovery({ queries, maxCandidates: Math.min(Math.max(input.maxCandidates * 4, 12), 90), earlyStopCandidateCount: Math.min(Math.max(input.maxCandidates * 3, 10), 70), pagesPerQuery: 2, maxQueriesToExecute: queries.length, maxDurationMs: 110_000, fetcher: input.fetcher });
  return {
    queries,
    candidates: result.candidates.map((candidate) => ({ provider: "searchapi", providerExternalId: candidate.username.toLowerCase(), instagramHandle: candidate.username.toLowerCase(), profileUrl: candidate.profileUrl,
      title: candidate.title, snippet: candidate.snippet, sourceQuery: candidate.sourceQuery, position: candidate.position, extractionMode: candidate.extractionMode ?? "strict" })),
    diagnostic: { queriesExecuted: result.queriesExecuted, queriesSucceeded: result.queriesSucceeded, queriesFailed: result.queriesFailed, pagesFetched: result.pagesFetched,
      organicResultsScanned: result.organicResultsScanned, extractedCandidatesCount: result.extractedCandidatesCount, rejectedNonProfileCount: result.rejectedNonProfileCount, stoppedReason: result.stoppedReason },
  };
}
