import { runTargetAiGoogleSerpDiscovery } from "@/lib/instagram-client/target-ai-google-serp-discovery";
import type { CommercialDiscoveryCity, CommercialDiscoveryCountry, CommercialDiscoverySubsegment } from "./discovery-contract";
import { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio";
import { franceDiagnosticFetcher, type FranceQueryDiagnostic } from "./france-query-diagnostics";
import { runFranceProfileFirst, type PersistPage } from "./france-profile-first";

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
  experimentAttribution?: unknown;
};

export type CommercialDiscoveryProviderResult = {
  candidates: CommercialDiscoveryCandidate[];
  queries: string[];
  diagnostic: Record<string, unknown>;
};

export async function discoverCommercialCandidates(input: { city: CommercialDiscoveryCity; countryCode?: CommercialDiscoveryCountry; subsegment?: CommercialDiscoverySubsegment; maxCandidates: number; fetcher?: typeof fetch; experiment?: { runId: string; persist: PersistPage } }): Promise<CommercialDiscoveryProviderResult> {
  const countryCode = input.countryCode ?? (input.city === "France" ? "FR" : "ZA");
  if (input.city === "France" && countryCode === "FR" && input.experiment) {
    const result = await runFranceProfileFirst({ runId: input.experiment.runId, persist: input.experiment.persist, fetcher: input.fetcher,
      apiKey: process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim() || process.env.TARGET_AI_SEARCHAPI_KEY?.trim() || "",
      endpoint: process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL?.trim() || process.env.TARGET_AI_DISCOVERY_SEARCH_URL?.trim() || "https://www.searchapi.io/api/v1/search" });
    return { queries: result.queries, diagnostic: result.diagnostic, candidates: result.candidates.map(c => ({
      provider: "searchapi", providerExternalId: c.username.toLowerCase(), instagramHandle: c.username.toLowerCase(), profileUrl: c.profileUrl,
      title: c.title, snippet: c.snippet, sourceQuery: c.sourceQuery, position: c.position, extractionMode: c.extractionMode ?? "strict", experimentAttribution: result.attributions[c.username.toLowerCase()],
    })) };
  }
  const queries = buildCommercialDiscoveryQueries(input.city, input.subsegment, countryCode);
  const queryDiagnostics: FranceQueryDiagnostic[] = [];
  const isFrance = countryCode === "FR";
  const fetcher = isFrance ? franceDiagnosticFetcher(input.fetcher ?? fetch, queryDiagnostics) : input.fetcher;
  const result = await runTargetAiGoogleSerpDiscovery({ queries, maxCandidates: isFrance ? input.maxCandidates : Math.min(Math.max(input.maxCandidates * 4, 12), 90), earlyStopCandidateCount: isFrance ? input.maxCandidates : Math.min(Math.max(input.maxCandidates * 3, 10), 70), pagesPerQuery: 2, maxQueriesToExecute: queries.length, maxDurationMs: 110_000, fetcher });
  return {
    queries,
    candidates: (isFrance ? result.candidates.slice(0, input.maxCandidates) : result.candidates).map((candidate) => ({ provider: "searchapi", providerExternalId: candidate.username.toLowerCase(), instagramHandle: candidate.username.toLowerCase(), profileUrl: candidate.profileUrl,
      title: candidate.title, snippet: candidate.snippet, sourceQuery: candidate.sourceQuery, position: candidate.position, extractionMode: candidate.extractionMode ?? "strict" })),
    diagnostic: { ...(isFrance ? { queryDiagnostics } : {}), queriesExecuted: result.queriesExecuted, queriesSucceeded: result.queriesSucceeded, queriesFailed: result.queriesFailed, pagesFetched: result.pagesFetched,
      organicResultsScanned: result.organicResultsScanned, extractedCandidatesCount: result.extractedCandidatesCount, rejectedNonProfileCount: result.rejectedNonProfileCount, stoppedReason: result.stoppedReason },
  };
}
