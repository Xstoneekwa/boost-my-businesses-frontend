import { mapWithConcurrency } from "../instagram-dashboard/target-provider-enrichment.ts";
import { evaluateAiTargetEligibility } from "./target-ai-eligibility.ts";
import {
  buildTargetAiDiscoverySessionKey,
  getTargetAiDiscoverySession,
  saveTargetAiDiscoverySession,
  updateTargetAiDiscoverySessionCandidates,
} from "./target-ai-discovery-session.ts";
import { buildTargetAiRuntimeQueryPlan } from "./target-ai-query-plan.ts";
import { buildTargetAiRuntimeHarnessDiff } from "./target-ai-runtime-harness-diff.ts";
import { runTargetAiGoogleSerpDiscovery } from "./target-ai-google-serp-discovery.ts";
import { resolveActiveTargetingAiConfig } from "./targeting-ai-config-store.ts";
import type { SerpProfileCandidate } from "./target-ai-serp-extractor.ts";
import { evaluateSerpClientProjection, needsTargetAiProfileVerification } from "./target-ai-client-projection.ts";
import { rankSerpProfileCandidates } from "./target-ai-serp-score.ts";
import { cacheResolvedAvatarUrl } from "./target-avatar-proxy-server.ts";
import {
  applyTargetAiProfileVerifyStats,
  createTargetAiProfileVerifyStats,
  readTargetAiVerifyConcurrency,
  readTargetAiVerifyStaggerMs,
  verifyTargetAiProfileUsername,
} from "./target-ai-profile-verify.ts";
import { resolveTargetAiUiDiscoveryProfile } from "./target-ai-ui-discovery-profile.ts";
import { scoreTargetAiCandidateRelevance } from "./target-ai-relevance-score.ts";
import type {
  TargetAiSearchCandidate,
  TargetAiSearchDebugSummary,
  TargetAiSearchLocation,
  TargetAiSearchResult,
} from "./target-ai-search-service.ts";

export type TargetAiVerificationSummary = {
  pending_count: number;
  verified_count: number;
  eligible_count: number;
  ineligible_count: number;
  rate_limited_count: number;
  provider_error_count: number;
};

export type TargetAiSearchV2Result = TargetAiSearchResult & {
  session_id: string;
  mode: "searchapi_loose_v21";
  candidates: TargetAiSearchCandidate[];
  unverifiedCandidates: TargetAiSearchCandidate[];
  verifiedCandidates: TargetAiSearchCandidate[];
  verificationSummary: TargetAiVerificationSummary;
};

function safeLog(event: string, fields: Record<string, unknown>) {
  console.info("[Target AI search V2]", { event, ...fields });
}

function readIntEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function readProfileText(metadata: Record<string, string | number | boolean | null>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function mapSerpCandidateToSearchCandidate(input: {
  serp: SerpProfileCandidate & { serpScore?: number };
  niche: string;
  locationLabel: string | null;
  verified?: Partial<TargetAiSearchCandidate>;
}): TargetAiSearchCandidate {
  const verified = input.verified;
  if (verified?.verificationStatus && verified.verificationStatus !== "pending") {
    return {
      username: input.serp.username,
      followersCount: verified.followersCount ?? null,
      avatarUrl: verified.avatarUrl ?? null,
      avatarAvailable: Boolean(verified.avatarAvailable),
      eligible: Boolean(verified.eligible),
      ineligibleReasonCode: verified.ineligibleReasonCode ?? null,
      profileUrl: verified.profileUrl ?? input.serp.profileUrl,
      isVerified: verified.isVerified ?? null,
      isPrivate: verified.isPrivate ?? null,
      verificationStatus: verified.verificationStatus,
      qualityStatus: verified.qualityStatus ?? "unknown",
      relevanceScore: verified.relevanceScore ?? input.serp.serpScore ?? 0,
      serpTitle: input.serp.title,
      serpSnippet: input.serp.snippet,
      serpSourceQuery: input.serp.sourceQuery,
      serpPosition: input.serp.position,
    };
  }

  const projection = evaluateSerpClientProjection({
    candidate: input.serp,
    niche: input.niche,
    locationLabel: input.locationLabel,
  });

  if (!projection.needsProfileVerify) {
    return {
      username: input.serp.username,
      followersCount: null,
      avatarUrl: null,
      avatarAvailable: false,
      eligible: projection.eligible,
      ineligibleReasonCode: projection.reasonCode,
      profileUrl: input.serp.profileUrl,
      isVerified: null,
      isPrivate: null,
      verificationStatus: projection.verificationStatus,
      qualityStatus: projection.qualityStatus,
      relevanceScore: projection.serpScore,
      serpTitle: input.serp.title,
      serpSnippet: input.serp.snippet,
      serpSourceQuery: input.serp.sourceQuery,
      serpPosition: input.serp.position,
    };
  }

  const relevanceScore = Math.max(
    projection.serpScore,
    scoreTargetAiCandidateRelevance({
      username: input.serp.username,
      niche: input.niche,
      locationLabel: input.locationLabel,
      profileName: input.serp.title,
      biography: input.serp.snippet,
    }),
  );

  return {
    username: input.serp.username,
    followersCount: null,
    avatarUrl: null,
    avatarAvailable: false,
    eligible: false,
    ineligibleReasonCode: "pending_verification",
    profileUrl: input.serp.profileUrl,
    isVerified: null,
    isPrivate: null,
    verificationStatus: "pending",
    qualityStatus: "pending_verification",
    relevanceScore,
    serpTitle: input.serp.title,
    serpSnippet: input.serp.snippet,
    serpSourceQuery: input.serp.sourceQuery,
    serpPosition: input.serp.position,
  };
}

function summarizeVerification(candidates: TargetAiSearchCandidate[]): TargetAiVerificationSummary {
  const verified = candidates.filter((row) => row.verificationStatus === "found");
  const pending = candidates.filter((row) => row.verificationStatus === "pending");
  return {
    pending_count: pending.length,
    verified_count: verified.length,
    eligible_count: verified.filter((row) => row.eligible).length,
    ineligible_count: verified.filter((row) => !row.eligible).length,
    rate_limited_count: candidates.filter((row) => row.verificationStatus === "rate_limited").length,
    provider_error_count: candidates.filter((row) => row.qualityStatus === "provider_error").length,
  };
}

function buildDebugSummary(input: {
  config: Awaited<ReturnType<typeof resolveActiveTargetingAiConfig>>;
  startedAt: number;
  queries: string[];
  locationLabel: string | null;
  serpStats: Awaited<ReturnType<typeof runTargetAiGoogleSerpDiscovery>>;
  verifyStats: ReturnType<typeof createTargetAiProfileVerifyStats>;
  candidates: TargetAiSearchCandidate[];
  autoVerifiedCount: number;
  stoppedReason: string;
}): TargetAiSearchDebugSummary {
  const displayed = input.candidates;
  const relevanceScores = displayed.map((row) => row.relevanceScore);
  return {
    prompt_version: input.config.prompt_version,
    prompt_source: input.config.prompt_source,
    model: input.config.model,
    provider: "openai",
    niche_present: true,
    location_present: Boolean(input.locationLabel),
    max_displayed_results: input.config.max_displayed_results,
    max_searchapi_checks: readIntEnv("TARGET_AI_V2_AUTO_VERIFY_COUNT", 28, 0, 40),
    max_latency_ms: readIntEnv("TARGET_AI_V2_DISCOVERY_MAX_MS", 45_000, 20_000, 90_000),
    profile_lookup_concurrency: readTargetAiVerifyConcurrency(),
    gpt_search_queries_count: 0,
    gpt_seed_usernames_count: 0,
    searchapi_discovery_queries_count: input.serpStats.queriesExecuted,
    extracted_usernames_count: input.serpStats.extractedCandidatesCount,
    profile_checked_count: input.verifyStats.checked,
    profile_found_count: input.verifyStats.found,
    profile_found_partial_count: input.verifyStats.foundPartial,
    profile_not_found_count: input.verifyStats.notFound,
    profile_provider_error_count: input.verifyStats.providerError,
    profile_rate_limited_count: input.verifyStats.rateLimited,
    profile_timeout_count: input.verifyStats.timeout,
    profile_invalid_response_count: input.verifyStats.invalidResponse,
    profile_skipped_low_score_count: 0,
    profile_retried_count: input.verifyStats.retried,
    profile_skipped_count: 0,
    duplicate_skipped_count: 0,
    avatar_available_count: displayed.filter((row) => row.avatarAvailable).length,
    avatar_missing_count: displayed.filter((row) => !row.avatarAvailable).length,
    eligible_count: displayed.filter((row) => row.eligible).length,
    ineligible_count: displayed.filter((row) => row.verificationStatus === "found" && !row.eligible).length,
    eligible_displayed_count: displayed.filter((row) => row.eligible).length,
    ineligible_displayed_count: displayed.filter((row) => row.verificationStatus === "found" && !row.eligible).length,
    displayed_count: displayed.length,
    final_results_count: displayed.length,
    second_pass_used: false,
    third_pass_used: false,
    stopped_reason: input.stoppedReason,
    provider_error_reasons_top: [],
    rejection_reasons_top: [],
    relevance_score_top: relevanceScores.length ? Math.max(...relevanceScores) : null,
    relevance_score_bottom: relevanceScores.length ? Math.min(...relevanceScores) : null,
    latency_ms: Date.now() - input.startedAt,
    error_code: null,
    gpt_candidates_count: 0,
    searchapi_checked_count: input.verifyStats.checked,
    found_count: input.verifyStats.found + input.verifyStats.foundPartial,
    not_found_count: input.verifyStats.notFound,
  };
}

export async function verifyTargetAiUsernamesBatch(input: {
  usernames: string[];
  niche: string;
  locationLabel: string | null;
  serpByUsername: Map<string, SerpProfileCandidate & { serpScore?: number }>;
  concurrency?: number;
  existingVerified?: Map<string, TargetAiSearchCandidate>;
}) {
  const stats = createTargetAiProfileVerifyStats();
  const concurrency = input.concurrency ?? readTargetAiVerifyConcurrency();
  const staggerMs = readTargetAiVerifyStaggerMs(concurrency);
  const verifiedByUsername = new Map<string, TargetAiSearchCandidate>();
  const usernamesToVerify = input.usernames.filter((username) => {
    const cached = input.existingVerified?.get(username);
    if (cached && cached.verificationStatus !== "pending") {
      verifiedByUsername.set(username, cached);
      stats.duplicateSkipped += 1;
      return false;
    }
    return true;
  });

  await mapWithConcurrency(usernamesToVerify, concurrency, async (username, index) => {
    if (staggerMs > 0 && index > 0) {
      await new Promise((resolve) => setTimeout(resolve, staggerMs));
    }
    const serp = input.serpByUsername.get(username);
    if (!serp) return null;
    const projection = evaluateSerpClientProjection({
      candidate: serp,
      niche: input.niche,
      locationLabel: input.locationLabel,
    });
    const result = await verifyTargetAiProfileUsername(username);
    const eligibility = evaluateAiTargetEligibility({
      niche: input.niche,
      locHit: projection.locHit,
      nicheHit: projection.nicheHit,
      quality_status: result.decision.quality_status,
      status: result.decision.status,
      followers_count: result.decision.followers_count,
      is_verified: result.decision.is_verified,
      is_private: result.decision.is_private,
      verification_status: result.decision.verification_status,
    });
    const avatarUrl = result.decision.avatar_url ?? null;
    if (avatarUrl) cacheResolvedAvatarUrl(username, avatarUrl);
    applyTargetAiProfileVerifyStats(stats, {
      errorReason: result.errorReason,
      verificationStatus: result.decision.verification_status,
      retried: result.retried,
      partialFound: result.decision.verification_status === "found"
        && (!result.decision.followers_count || !avatarUrl),
    });
    const candidate = mapSerpCandidateToSearchCandidate({
      serp,
      niche: input.niche,
      locationLabel: input.locationLabel,
      verified: {
        followersCount: result.decision.followers_count,
        avatarUrl,
        avatarAvailable: Boolean(avatarUrl),
        eligible: eligibility.eligible,
        ineligibleReasonCode: eligibility.reasonCode,
        profileUrl: `https://www.instagram.com/${encodeURIComponent(username)}/`,
        isVerified: result.decision.is_verified,
        isPrivate: result.decision.is_private,
        verificationStatus: result.decision.verification_status,
        qualityStatus: result.decision.quality_status,
        relevanceScore: Math.max(
          serp.serpScore ?? 0,
          scoreTargetAiCandidateRelevance({
            username,
            niche: input.niche,
            locationLabel: input.locationLabel,
            profileName: readProfileText(result.lookup.metadata, "profile_name") ?? serp.title,
            biography: readProfileText(result.lookup.metadata, "biography") ?? serp.snippet,
          }),
        ),
      },
    });
    verifiedByUsername.set(username, candidate);
    return candidate;
  });

  return { verifiedByUsername, stats };
}

function sortCandidatesForDisplay(candidates: TargetAiSearchCandidate[]) {
  return [...candidates].sort((left, right) => {
    const rank = (row: TargetAiSearchCandidate) => {
      if (row.eligible) return 0;
      if (row.verificationStatus === "found" && !row.eligible) return 1;
      return 2;
    };
    const rankDiff = rank(left) - rank(right);
    if (rankDiff !== 0) return rankDiff;
    return (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0);
  });
}

export function mergeSerpAndVerifiedCandidates(input: {
  rankedSerp: Array<SerpProfileCandidate & { serpScore: number }>;
  verifiedByUsername: Map<string, TargetAiSearchCandidate>;
  niche: string;
  locationLabel: string | null;
  maxDisplayed: number;
}) {
  const candidates = sortCandidatesForDisplay(
    input.rankedSerp.slice(0, input.maxDisplayed).map((serp) => {
      const verified = input.verifiedByUsername.get(serp.username);
      if (verified) return verified;
      return mapSerpCandidateToSearchCandidate({
        serp,
        niche: input.niche,
        locationLabel: input.locationLabel,
      });
    }),
  );
  return {
    candidates,
    unverifiedCandidates: candidates.filter((row) => row.verificationStatus === "pending"),
    verifiedCandidates: candidates.filter((row) => row.verificationStatus === "found"),
  };
}

export async function searchTargetAccountsWithAiV2(input: {
  accountId: string;
  niche: string;
  location?: TargetAiSearchLocation | null;
  maxCandidates?: number;
}): Promise<TargetAiSearchV2Result> {
  const startedAt = Date.now();
  const config = await resolveActiveTargetingAiConfig();
  const niche = input.niche.trim();
  const locationLabel = input.location?.label ?? null;
  const sessionId = buildTargetAiDiscoverySessionKey({
    accountId: input.accountId,
    niche,
    locationLabel,
  });

  const cached = getTargetAiDiscoverySession(sessionId);
  if (cached) {
    safeLog("session_cache_hit", { session_id: sessionId, candidates: cached.candidates.length });
    safeLog("runtime_query_plan", {
      session_cache: "hit",
      normalizedLocation: locationLabel,
      locationKind: "unknown",
      locationTokens: [],
      nicheTokens: [],
      loose_queries_count: 0,
      strict_queries_count: 0,
      total_queries_count: 0,
      pages_per_query: readIntEnv("TARGET_AI_V2_SERP_PAGES", 3, 2, 4),
      max_queries_cap: readIntEnv("TARGET_AI_V2_MAX_GOOGLE_QUERIES", 24, 12, 30),
      first_20_queries: [],
    });
    const verificationSummary = summarizeVerification(cached.candidates);
    return {
      status: cached.candidates.length > 0 ? "ok" : "no_candidates",
      provider: "openai",
      mode: "searchapi_loose_v21",
      session_id: sessionId,
      candidates: cached.candidates,
      unverifiedCandidates: cached.candidates.filter((row) => row.verificationStatus === "pending"),
      verifiedCandidates: cached.candidates.filter((row) => row.verificationStatus === "found"),
      verificationSummary,
      suggested_count: cached.serpCandidates.length,
      verified_count: verificationSummary.verified_count,
      avatar_resolved: cached.candidates.filter((row) => row.avatarAvailable).length,
      error_code: cached.candidates.length > 0 ? null : "no_candidates_found",
      debug: buildDebugSummary({
        config,
        startedAt,
        queries: [],
        locationLabel,
        serpStats: {
          candidates: cached.serpCandidates,
          queriesExecuted: 0,
          queriesSucceeded: 0,
          queriesFailed: 0,
          queriesThrottled: 0,
          pagesFetched: 0,
          organicResultsScanned: 0,
          extractedCandidatesCount: cached.serpCandidates.length,
          strictExtractedCount: cached.serpCandidates.length,
          looseExtractedCount: 0,
          rejectedNonProfileCount: 0,
          rejectionsByReason: {},
          stoppedReason: "session_cache_hit",
        },
        verifyStats: createTargetAiProfileVerifyStats(),
        candidates: cached.candidates,
        autoVerifiedCount: verificationSummary.verified_count,
        stoppedReason: "session_cache_hit",
      }),
    };
  }

  const uiDiscovery = resolveTargetAiUiDiscoveryProfile({ niche, locationLabel });
  const maxSerpCandidates = readIntEnv("TARGET_AI_V2_MAX_SERP_CANDIDATES", uiDiscovery.maxSerpCandidates, 30, 80);
  const maxQueries = readIntEnv("TARGET_AI_V2_MAX_GOOGLE_QUERIES", 24, 12, 30);
  const pagesPerQuery = readIntEnv("TARGET_AI_V2_SERP_PAGES", uiDiscovery.pagesPerQuery, 1, 4);

  const queryPlan = buildTargetAiRuntimeQueryPlan({ niche, locationLabel, maxQueries });
  const queries = queryPlan.queries;
  const discoveryMaxMs = readIntEnv(
    "TARGET_AI_V2_DISCOVERY_MAX_MS",
    uiDiscovery.discoveryMaxMs,
    45_000,
    120_000,
  );

  safeLog("runtime_query_plan", {
    ...queryPlan,
    session_cache: "miss",
  });

  if (queries.length === 0) {
    safeLog("search_aborted", { reason: "empty_query_plan", locationLabel, niche });
    return {
      status: "no_candidates",
      provider: "openai",
      mode: "searchapi_loose_v21",
      session_id: sessionId,
      candidates: [],
      unverifiedCandidates: [],
      verifiedCandidates: [],
      verificationSummary: summarizeVerification([]),
      suggested_count: 0,
      verified_count: 0,
      avatar_resolved: 0,
      error_code: "invalid_location",
      debug: buildDebugSummary({
        config,
        startedAt,
        queries: [],
        locationLabel,
        serpStats: {
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
          stoppedReason: "empty_query_plan",
        },
        verifyStats: createTargetAiProfileVerifyStats(),
        candidates: [],
        autoVerifiedCount: 0,
        stoppedReason: "empty_query_plan",
      }),
    };
  }

  safeLog("google_queries_built", {
    count: queries.length,
    pages_per_query: pagesPerQuery,
    sample: queries.slice(0, 4),
    query_mode: "loose_first",
    loose_queries_count: queryPlan.loose_queries_count,
    strict_queries_count: queryPlan.strict_queries_count,
  });

  const serpStats = await runTargetAiGoogleSerpDiscovery({
    queries,
    maxCandidates: maxSerpCandidates,
    pagesPerQuery,
    maxDurationMs: discoveryMaxMs,
    earlyStopCandidateCount: uiDiscovery.earlyStopCandidateCount,
    maxQueriesToExecute: uiDiscovery.maxQueriesToExecute,
    thirdPageMinCandidates: uiDiscovery.thirdPageMinCandidates,
  });

  const rankedSerp = rankSerpProfileCandidates(serpStats.candidates, niche, locationLabel)
    .map((row) => ({ ...row, serpScore: row.serpScore }));

  if (rankedSerp.length === 0) {
    return {
      status: "no_candidates",
      provider: "openai",
      mode: "searchapi_loose_v21",
      session_id: sessionId,
      candidates: [],
      unverifiedCandidates: [],
      verifiedCandidates: [],
      verificationSummary: summarizeVerification([]),
      suggested_count: 0,
      verified_count: 0,
      avatar_resolved: 0,
      error_code: "no_candidates_found",
      debug: buildDebugSummary({
        config,
        startedAt,
        queries,
        locationLabel,
        serpStats,
        verifyStats: createTargetAiProfileVerifyStats(),
        candidates: [],
        autoVerifiedCount: 0,
        stoppedReason: "insufficient_candidates",
      }),
    };
  }

  const serpByUsername = new Map(rankedSerp.map((row) => [row.username, row]));
  const pendingToVerify = rankedSerp
    .filter((row) => needsTargetAiProfileVerification(evaluateSerpClientProjection({
      candidate: row,
      niche,
      locationLabel,
    })))
    .map((row) => row.username);

  const verifyConcurrency = readTargetAiVerifyConcurrency();
  const { verifiedByUsername: workingVerifiedByUsername, stats: verifyStats } = pendingToVerify.length > 0
    ? await verifyTargetAiUsernamesBatch({
      usernames: pendingToVerify,
      niche,
      locationLabel,
      serpByUsername,
      concurrency: verifyConcurrency,
    })
    : { verifiedByUsername: new Map<string, TargetAiSearchCandidate>(), stats: createTargetAiProfileVerifyStats() };

  const merged = mergeSerpAndVerifiedCandidates({
    rankedSerp,
    verifiedByUsername: workingVerifiedByUsername,
    niche,
    locationLabel,
    maxDisplayed: maxSerpCandidates,
  });

  const harnessDiff = buildTargetAiRuntimeHarnessDiff({
    niche,
    locationLabel,
    runtimeQueries: queries,
    organicResultsScanned: serpStats.organicResultsScanned,
    extractedCandidates: serpStats.candidates,
    rankedUsernames: rankedSerp.map((row) => row.username),
    displayedUsernames: merged.candidates.map((row) => row.username),
    scoredCandidates: rankedSerp.map((row) => ({
      username: row.username,
      serpScore: row.serpScore,
      sourceQuery: row.sourceQuery,
    })),
  });

  safeLog("runtime_vs_harness_diff", {
    ...harnessDiff,
    instagram_urls: serpStats.organicResultsScanned,
    profile_urls: serpStats.strictExtractedCount + serpStats.looseExtractedCount,
    usernames_rejected: serpStats.rejectedNonProfileCount,
    rejections_by_reason: serpStats.rejectionsByReason,
    strict_extracted_count: serpStats.strictExtractedCount,
    loose_extracted_count: serpStats.looseExtractedCount,
    discovery_max_ms: discoveryMaxMs,
  });

  saveTargetAiDiscoverySession({
    sessionId,
    accountId: input.accountId,
    niche,
    locationLabel,
    serpCandidates: rankedSerp,
    candidates: merged.candidates,
  });

  const verificationSummary = summarizeVerification(merged.candidates);
  const stoppedReason = serpStats.stoppedReason
    ?? (merged.candidates.length >= 30 ? "serp_candidates_ready" : "insufficient_candidates");

  safeLog("search_completed", {
    session_id: sessionId,
    serp_candidates: rankedSerp.length,
    displayed_count: merged.candidates.length,
    auto_verified_count: verificationSummary.verified_count,
    auto_verify_attempted: pendingToVerify.length,
    profile_found_count: verifyStats.found,
    profile_rate_limited_count: verifyStats.rateLimited,
    latency_ms: Date.now() - startedAt,
    stopped_reason: stoppedReason,
    loose_queries_count: queryPlan.loose_queries_count,
    strict_queries_count: queryPlan.strict_queries_count,
    total_queries_executed: serpStats.queriesExecuted,
    pages_per_query: pagesPerQuery,
    location_kind: queryPlan.locationKind,
    location_tokens_count: queryPlan.locationTokens.length,
  });

  return {
    status: "ok",
    provider: "openai",
    mode: "searchapi_loose_v21",
    session_id: sessionId,
    candidates: merged.candidates,
    unverifiedCandidates: merged.unverifiedCandidates,
    verifiedCandidates: merged.verifiedCandidates,
    verificationSummary,
    suggested_count: rankedSerp.length,
    verified_count: verificationSummary.verified_count,
    avatar_resolved: merged.candidates.filter((row) => row.avatarAvailable).length,
    error_code: null,
    debug: buildDebugSummary({
      config,
      startedAt,
      queries,
      locationLabel,
      serpStats,
      verifyStats,
      candidates: merged.candidates,
      autoVerifiedCount: verificationSummary.verified_count,
      stoppedReason,
    }),
  };
}

export async function verifyTargetAiSessionUsernames(input: {
  sessionId: string;
  usernames: string[];
  niche?: string;
  locationLabel?: string | null;
}) {
  const session = getTargetAiDiscoverySession(input.sessionId);
  if (!session) return null;

  const niche = input.niche?.trim() || session.niche;
  const locationLabel = input.locationLabel ?? session.locationLabel;
  const serpByUsername = new Map(
    session.serpCandidates.map((row) => [row.username, row as SerpProfileCandidate & { serpScore?: number }]),
  );
  const existingVerified = new Map(
    session.candidates
      .filter((candidate) => candidate.verificationStatus !== "pending")
      .map((candidate) => [candidate.username, candidate]),
  );
  const { verifiedByUsername, stats } = await verifyTargetAiUsernamesBatch({
    usernames: input.usernames.filter((username) => serpByUsername.has(username)),
    niche,
    locationLabel,
    serpByUsername,
    concurrency: readTargetAiVerifyConcurrency(),
    existingVerified,
  });

  const updated = session.candidates.map((candidate) => verifiedByUsername.get(candidate.username) ?? candidate);
  updateTargetAiDiscoverySessionCandidates(input.sessionId, updated);

  return {
    candidates: input.usernames
      .map((username) => updated.find((row) => row.username === username))
      .filter((row): row is TargetAiSearchCandidate => Boolean(row)),
    stats,
    verificationSummary: summarizeVerification(updated),
  };
}

export function isTargetAiV2Enabled() {
  return process.env.TARGET_AI_V2_ENABLED !== "false";
}
