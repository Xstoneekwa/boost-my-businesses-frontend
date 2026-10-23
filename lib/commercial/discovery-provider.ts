import { runTargetAiGoogleSerpDiscovery } from "@/lib/instagram-client/target-ai-google-serp-discovery";
import type { CommercialDiscoveryCity, CommercialDiscoveryCountry, CommercialDiscoverySubsegment } from "./discovery-contract";
import { buildCommercialDiscoveryQueries } from "./discovery-query-portfolio";
import { franceDiagnosticFetcher, franceSemanticSerpCounters, type FranceQueryDiagnostic } from "./france-query-diagnostics";
import { runFranceProfileFirst, type PersistPage } from "./france-profile-first";
import { assessFranceSerpCandidate } from "./france-acquisition";
import { franceLocalizedSearchFetcher, resolveFranceSearchLocation } from "./france-search-location";

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

export async function discoverCommercialCandidates(input: { city: CommercialDiscoveryCity; countryCode?: CommercialDiscoveryCountry; subsegment?: CommercialDiscoverySubsegment | null; maxCandidates: number; fetcher?: typeof fetch; experiment?: { runId: string; persist: PersistPage } }): Promise<CommercialDiscoveryProviderResult> {
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
  // City broad canary only: leave targeted, ZA and historical national flows alone.
  const franceBroadCity = isFrance && input.city !== "France" && !input.subsegment;
  const prefilter = { version: "FR_SERP_TRIAGE_V1", evaluated: 0, kept: 0, rejected: 0, reasons: {} as Record<string, number> };
  const candidateFilter = isFrance ? (candidate: Parameters<typeof assessFranceSerpCandidate>[0]) => {
    const decision = assessFranceSerpCandidate(candidate);
    prefilter.evaluated += 1;
    prefilter[decision.keep ? "kept" : "rejected"] += 1;
    prefilter.reasons[decision.reason] = (prefilter.reasons[decision.reason] ?? 0) + 1;
    return decision.keep;
  } : undefined;
  // Resolve once for the discovery batch, not once per query/page/candidate.
  // The country context selects this path; the city label is not a market test.
  const location = isFrance ? await resolveFranceSearchLocation({ city: input.city,
    apiKey: process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim() || process.env.TARGET_AI_SEARCHAPI_KEY?.trim() || "",
    fetcher: input.fetcher ?? fetch }) : null;
  if (location && !location.ok) return { queries, candidates: [], diagnostic: {
    queryDiagnostics, acquisitionPrefilter: prefilter, searchLocation: location.diagnostic,
    providerOutcomeCounters: franceSemanticSerpCounters(queryDiagnostics), queriesExecuted: 0, queriesSucceeded: 0,
    queriesFailed: 0, pagesFetched: 0, organicResultsScanned: 0, extractedCandidatesCount: 0,
    rejectedNonProfileCount: 0, stoppedReason: location.reason,
  } };
  const fetcher = location?.ok ? franceDiagnosticFetcher(franceLocalizedSearchFetcher(input.fetcher ?? fetch, location), queryDiagnostics) : input.fetcher;
  const result = await runTargetAiGoogleSerpDiscovery({ queries, maxCandidates: isFrance ? input.maxCandidates : Math.min(Math.max(input.maxCandidates * 4, 12), 90), earlyStopCandidateCount: isFrance ? input.maxCandidates : Math.min(Math.max(input.maxCandidates * 3, 10), 70), pagesPerQuery: franceBroadCity ? 1 : 2, maxQueriesToExecute: queries.length, maxDurationMs: 110_000, fetcher, ...(candidateFilter ? { candidateFilter } : {}) });
  const semantic = isFrance ? franceSemanticSerpCounters(queryDiagnostics) : null;
  return {
    queries,
    candidates: (isFrance ? result.candidates.slice(0, input.maxCandidates) : result.candidates).map((candidate) => ({ provider: "searchapi", providerExternalId: candidate.username.toLowerCase(), instagramHandle: candidate.username.toLowerCase(), profileUrl: candidate.profileUrl,
      title: candidate.title, snippet: candidate.snippet, sourceQuery: candidate.sourceQuery, position: candidate.position, extractionMode: candidate.extractionMode ?? "strict" })),
    diagnostic: { ...(isFrance ? { queryDiagnostics: queryDiagnostics.map(d => ({ ...d, ...(location?.ok ? {
      COUNTRY: "FR", REQUESTED_CITY: input.city, SEARCH_LOCATION: location.canonicalName, GL: "fr", HL: "fr", PAGE: d.page,
    } : {}) })), acquisitionPrefilter: prefilter, providerOutcomeCounters: semantic, searchLocation: location?.diagnostic } : {}),
      queriesExecuted: result.queriesExecuted, queriesSucceeded: semantic?.serp_ok ?? result.queriesSucceeded,
      queriesFailed: semantic ? semantic.provider_errors + semantic.timeout : result.queriesFailed, pagesFetched: result.pagesFetched,
      organicResultsScanned: result.organicResultsScanned, extractedCandidatesCount: result.extractedCandidatesCount, rejectedNonProfileCount: result.rejectedNonProfileCount, stoppedReason: result.stoppedReason },
  };
}
