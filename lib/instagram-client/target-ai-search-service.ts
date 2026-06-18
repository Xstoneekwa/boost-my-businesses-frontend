import { mapWithConcurrency } from "../instagram-dashboard/target-provider-enrichment.ts";
import { normalizeTargetUsername } from "../instagram-targets.ts";
import { buildTargetAiDiscoveryQueries } from "./target-ai-discovery-queries.ts";
import { readTargetAiMockUsernames } from "./target-ai-contract.ts";
import { evaluateAiTargetEligibility } from "./target-ai-eligibility.ts";
import { callTargetAiOpenAiDiscovery } from "./targeting-ai-openai.ts";
import { resolveActiveTargetingAiConfig } from "./targeting-ai-config-store.ts";
import type { TargetingAiPromptSource } from "./targeting-ai-config-store.ts";
import {
  discoverInstagramUsernamesViaSearchApi,
  isTargetAiSearchApiDiscoveryConfigured,
  type DiscoveredInstagramCandidate,
} from "./target-ai-searchapi-discovery.ts";
import { mergeDiscoveredUsernames } from "./target-ai-instagram-url.ts";
import {
  applyTargetAiProfileVerifyStats,
  createTargetAiProfileVerifyStats,
  readTargetAiProfileLookupConcurrency,
  topTargetAiProviderErrorReasons,
  verifyTargetAiProfileUsername,
  type TargetAiProfileVerifyStats,
} from "./target-ai-profile-verify.ts";
import { scoreDiscoveryCandidate, rankDiscoveryCandidates } from "./target-ai-discovery-candidate-score.ts";
import { scoreTargetAiCandidateRelevance } from "./target-ai-relevance-score.ts";
import { TargetAiSearchRuntime, readTargetAiSearchRuntimeLimits } from "./target-ai-search-runtime.ts";
import { cacheResolvedAvatarUrl } from "./target-avatar-proxy-server.ts";

export type TargetAiSearchLocation = {
  label: string;
  lat: number;
  lon: number;
};

export type TargetAiSearchCandidate = {
  username: string;
  followersCount: number | null;
  avatarUrl: string | null;
  avatarAvailable: boolean;
  eligible: boolean;
  ineligibleReasonCode: string | null;
  profileUrl: string;
  isVerified: boolean | null;
  isPrivate: boolean | null;
  verificationStatus: string;
  qualityStatus: string;
  relevanceScore: number;
  serpTitle?: string | null;
  serpSnippet?: string | null;
  serpSourceQuery?: string | null;
  serpPosition?: number | null;
};

export type TargetAiSearchDebugSummary = {
  prompt_version: string;
  prompt_source: TargetingAiPromptSource;
  model: string;
  provider: "openai" | "mock";
  niche_present: boolean;
  location_present: boolean;
  max_displayed_results: number;
  max_searchapi_checks: number;
  max_latency_ms: number;
  profile_lookup_concurrency: number;
  gpt_search_queries_count: number;
  gpt_seed_usernames_count: number;
  searchapi_discovery_queries_count: number;
  extracted_usernames_count: number;
  profile_checked_count: number;
  profile_found_count: number;
  profile_found_partial_count: number;
  profile_not_found_count: number;
  profile_provider_error_count: number;
  profile_rate_limited_count: number;
  profile_timeout_count: number;
  profile_invalid_response_count: number;
  profile_skipped_low_score_count: number;
  profile_retried_count: number;
  profile_skipped_count: number;
  duplicate_skipped_count: number;
  avatar_available_count: number;
  avatar_missing_count: number;
  eligible_count: number;
  ineligible_count: number;
  eligible_displayed_count: number;
  ineligible_displayed_count: number;
  displayed_count: number;
  final_results_count: number;
  third_pass_used: boolean;
  second_pass_used: boolean;
  stopped_reason: string | null;
  provider_error_reasons_top: Array<{ reason: string; count: number }>;
  rejection_reasons_top: Array<{ reason: string; count: number }>;
  relevance_score_top: number | null;
  relevance_score_bottom: number | null;
  latency_ms: number;
  error_code: string | null;
  gpt_candidates_count: number;
  searchapi_checked_count: number;
  found_count: number;
  not_found_count: number;
};

export type TargetAiSearchResult = {
  status: "ok" | "ai_unavailable" | "no_candidates";
  provider: "openai" | "mock";
  candidates: TargetAiSearchCandidate[];
  suggested_count: number;
  verified_count: number;
  avatar_resolved: number;
  error_code: string | null;
  debug: TargetAiSearchDebugSummary;
};

type ScoredDiscoveryCandidate = DiscoveredInstagramCandidate & { discoveryScore: number };

function safeLog(event: string, fields: Record<string, unknown>) {
  console.info("[Target AI search]", { event, ...fields });
}

function countReasons(candidates: TargetAiSearchCandidate[]) {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.eligible) continue;
    const reason = candidate.ineligibleReasonCode || "rejected";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
}

function readProfileText(metadata: Record<string, string | number | boolean | null>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapVerifiedCandidate(
  username: string,
  decision: Awaited<ReturnType<typeof verifyTargetAiProfileUsername>>["decision"],
  lookup: Awaited<ReturnType<typeof verifyTargetAiProfileUsername>>["lookup"],
  niche: string,
  locationLabel: string | null,
  discoveryScore = 0,
): TargetAiSearchCandidate {
  const eligibility = evaluateAiTargetEligibility({
    quality_status: decision.quality_status,
    status: decision.status,
    followers_count: decision.followers_count,
    is_verified: decision.is_verified,
    is_private: decision.is_private,
    verification_status: decision.verification_status,
  });
  const avatarUrl = decision.avatar_url ?? null;
  if (avatarUrl) cacheResolvedAvatarUrl(username, avatarUrl);
  const relevanceScore = Math.max(
    discoveryScore,
    scoreTargetAiCandidateRelevance({
      username,
      niche,
      locationLabel,
      profileName: readProfileText(lookup.metadata, "profile_name"),
      biography: readProfileText(lookup.metadata, "biography"),
    }),
  );
  return {
    username,
    followersCount: decision.followers_count,
    avatarUrl,
    avatarAvailable: Boolean(avatarUrl),
    eligible: eligibility.eligible,
    ineligibleReasonCode: eligibility.reasonCode,
    profileUrl: `https://www.instagram.com/${encodeURIComponent(username)}/`,
    isVerified: decision.is_verified,
    isPrivate: decision.is_private,
    verificationStatus: decision.verification_status,
    qualityStatus: decision.quality_status,
    relevanceScore,
  };
}

function rankCandidates(candidates: TargetAiSearchCandidate[]) {
  return [...candidates].sort((left, right) => {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    if (left.relevanceScore !== right.relevanceScore) return right.relevanceScore - left.relevanceScore;
    const leftFollowers = left.followersCount ?? -1;
    const rightFollowers = right.followersCount ?? -1;
    return rightFollowers - leftFollowers;
  });
}

function selectDisplayCandidates(candidates: TargetAiSearchCandidate[], maxDisplayedResults: number) {
  return rankCandidates(candidates.filter((row) => row.verificationStatus === "found")).slice(0, maxDisplayedResults);
}

function countFound(candidates: TargetAiSearchCandidate[]) {
  return candidates.filter((row) => row.verificationStatus === "found").length;
}

function countEligible(candidates: TargetAiSearchCandidate[]) {
  return candidates.filter((row) => row.eligible).length;
}

function shouldStopProfileVerification(input: {
  verified: TargetAiSearchCandidate[];
  maxDisplayedResults: number;
  targetEligibleCount: number;
  runtime: TargetAiSearchRuntime;
}) {
  if (input.runtime.isTimeExceeded()) {
    input.runtime.markStopped("time_budget_reached");
    return true;
  }
  if (countFound(input.verified) >= input.maxDisplayedResults) {
    input.runtime.markStopped("max_displayed_reached");
    return true;
  }
  if (countEligible(input.verified) >= input.targetEligibleCount) {
    input.runtime.markStopped("eligible_target_reached");
    return true;
  }
  if (
    input.runtime.isRateLimitHardStop()
    && countFound(input.verified) >= input.runtime.limits.minDisplayedBeforeStop
  ) {
    input.runtime.markStopped("rate_limit_hard_stop");
    return true;
  }
  return false;
}

function mergeProfileStats(target: TargetAiProfileVerifyStats, source: TargetAiProfileVerifyStats) {
  target.checked += source.checked;
  target.found += source.found;
  target.foundPartial += source.foundPartial;
  target.notFound += source.notFound;
  target.providerError += source.providerError;
  target.rateLimited += source.rateLimited;
  target.timeout += source.timeout;
  target.invalidResponse += source.invalidResponse;
  target.skipped += source.skipped;
  target.skippedLowScore += source.skippedLowScore;
  target.duplicateSkipped += source.duplicateSkipped;
  target.retried += source.retried;
  for (const [reason, count] of source.errorReasons.entries()) {
    target.errorReasons.set(reason, (target.errorReasons.get(reason) ?? 0) + count);
  }
}

function scoreAndSortDiscoveryCandidates(
  candidates: DiscoveredInstagramCandidate[],
  niche: string,
  locationLabel: string | null,
  minScore: number,
) {
  const scored = candidates.map((candidate) => ({
    ...candidate,
    discoveryScore: scoreDiscoveryCandidate({
      username: candidate.username,
      niche,
      locationLabel,
      sourceQuery: candidate.sourceQuery,
      title: candidate.title,
      snippet: candidate.snippet,
    }),
  }));
  const ranked = rankDiscoveryCandidates(scored);
  const accepted = minScore <= -10
    ? ranked
    : ranked.filter((row) => row.discoveryScore >= minScore);
  return {
    ranked,
    accepted,
    skippedLowScore: Math.max(ranked.length - accepted.length, 0),
  };
}

async function verifyUsernames(
  scoredCandidates: ScoredDiscoveryCandidate[],
  seedUsernames: string[],
  concurrency: number,
  maxChecks: number,
  checked: Set<string>,
  runtime: TargetAiSearchRuntime,
  stopWhen: {
    maxDisplayedResults: number;
    targetEligibleCount: number;
    currentVerified: TargetAiSearchCandidate[];
    niche: string;
    locationLabel: string | null;
  },
) {
  const stats = createTargetAiProfileVerifyStats();
  const discoveryByUsername = new Map(scoredCandidates.map((row) => [row.username, row.discoveryScore]));
  const queue = [
    ...scoredCandidates.map((row) => row.username),
    ...seedUsernames,
  ]
    .map((username) => normalizeTargetUsername(username))
    .filter((username): username is string => Boolean(username))
    .filter((username) => {
      if (checked.has(username)) {
        stats.duplicateSkipped += 1;
        return false;
      }
      checked.add(username);
      return true;
    });

  const boundedQueue = queue.slice(0, maxChecks);
  stats.skipped = Math.max(queue.length - boundedQueue.length, 0);

  const verified: TargetAiSearchCandidate[] = [...stopWhen.currentVerified];
  let stopEarly = false;

  await mapWithConcurrency(boundedQueue, concurrency, async (username) => {
    if (stopEarly) return null;

    if (runtime.isTimeExceeded()) {
      runtime.markStopped("time_budget_reached");
      stopEarly = true;
      return null;
    }

    const result = await verifyTargetAiProfileUsername(username, runtime);
    const candidate = mapVerifiedCandidate(
      username,
      result.decision,
      result.lookup,
      stopWhen.niche,
      stopWhen.locationLabel,
      discoveryByUsername.get(username) ?? 0,
    );
    verified.push(candidate);
    applyTargetAiProfileVerifyStats(stats, {
      errorReason: result.errorReason,
      verificationStatus: candidate.verificationStatus,
      retried: result.retried,
      partialFound: candidate.verificationStatus === "found"
        && (!candidate.followersCount || !candidate.avatarAvailable),
    });

    if (
      result.errorReason !== "not_found"
      && result.errorReason !== "username_invalid"
      && candidate.verificationStatus !== "found"
    ) {
      safeLog("profile_lookup_issue", {
        username,
        reason: result.errorReason,
        verification_status: candidate.verificationStatus,
        retried: Boolean(result.retried),
      });
    }

    if (shouldStopProfileVerification({
      verified,
      maxDisplayedResults: stopWhen.maxDisplayedResults,
      targetEligibleCount: stopWhen.targetEligibleCount,
      runtime,
    })) {
      stopEarly = true;
    }

    return candidate;
  });

  return { verified, stats };
}

function logGptDiscovery(input: {
  discovery: Awaited<ReturnType<typeof callTargetAiOpenAiDiscovery>>["discovery"];
  pass: "primary" | "broadened" | "complementary";
  queries: string[];
}) {
  safeLog("gpt_discovery", {
    pass: input.pass,
    search_queries_count: input.discovery.searchQueries.length,
    built_queries_count: input.queries.length,
    built_queries_sample: input.queries.slice(0, 5).map((query) => query.slice(0, 120)),
    seed_usernames_count: input.discovery.usernames.length,
  });
}

async function runDiscoveryPass(input: {
  niche: string;
  locationLabel?: string | null;
  pass: "primary" | "broadened" | "complementary";
  config: Awaited<ReturnType<typeof resolveActiveTargetingAiConfig>>;
  runtime: TargetAiSearchRuntime;
  queryLimit: number;
}) {
  const limits = input.runtime.limits;
  const gpt = await callTargetAiOpenAiDiscovery({
    config: input.config,
    niche: input.niche,
    locationLabel: input.locationLabel,
    pass: input.pass === "complementary" ? "broadened" : input.pass,
  });

  const queries = buildTargetAiDiscoveryQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
    discovery: gpt.discovery,
    pass: input.pass,
    maxQueries: input.queryLimit,
  });

  logGptDiscovery({ discovery: gpt.discovery, pass: input.pass, queries });

  let discoveryCandidates: DiscoveredInstagramCandidate[] = [];
  let discoveryQueriesExecuted = 0;

  if (isTargetAiSearchApiDiscoveryConfigured() && queries.length > 0 && !input.runtime.isTimeExceeded()) {
    const searchResult = await discoverInstagramUsernamesViaSearchApi({
      queries,
      maxUsernames: limits.maxDiscoveredUsernames,
      maxPagesPerQuery: input.pass === "primary" ? 1 : 1,
      runtime: input.runtime,
    });
    discoveryCandidates = searchResult.candidates;
    discoveryQueriesExecuted = searchResult.queriesExecuted;
    safeLog("searchapi_discovery", {
      pass: input.pass,
      queries_executed: searchResult.queriesExecuted,
      queries_succeeded: searchResult.queriesSucceeded,
      queries_failed: searchResult.queriesFailed,
      organic_results_scanned: searchResult.organicResultsScanned,
      extracted_usernames_count: searchResult.extractedUsernamesCount,
    });
  }

  const scored = scoreAndSortDiscoveryCandidates(
    discoveryCandidates,
    input.niche,
    input.locationLabel ?? null,
    limits.minCandidateScore,
  );

  const mergedSeeds = mergeDiscoveredUsernames([gpt.usernames], limits.maxDiscoveredUsernames);

  return {
    gpt,
    queries,
    discoveryCandidates: scored.accepted,
    skippedLowScore: scored.skippedLowScore,
    seedUsernames: mergedSeeds.usernames,
    discoveryQueriesExecuted,
    extractedUsernamesCount: discoveryCandidates.length,
    duplicateSkippedCount: mergedSeeds.duplicateSkipped,
  };
}

function shouldRunBroadenedPass(input: {
  displayCount: number;
  profileStats: TargetAiProfileVerifyStats;
  runtime: TargetAiSearchRuntime;
  maxChecks: number;
  secondPassEnabled: boolean;
  displayThreshold: number;
}) {
  if (!input.secondPassEnabled) return false;
  if (input.runtime.isTimeExceeded()) return false;
  if (input.displayCount >= input.displayThreshold) return false;
  if (input.profileStats.found + input.profileStats.foundPartial >= input.displayThreshold) return false;
  return input.profileStats.checked < input.maxChecks - 4;
}

function shouldRunThirdPass(input: {
  displayCount: number;
  profileStats: TargetAiProfileVerifyStats;
  runtime: TargetAiSearchRuntime;
  maxChecks: number;
  thirdPassEnabled: boolean;
  displayThreshold: number;
}) {
  if (!input.thirdPassEnabled) return false;
  if (input.runtime.isTimeExceeded()) return false;
  if (input.runtime.isRateLimitHardStop()) return false;
  if (input.displayCount >= input.displayThreshold) return false;
  if (input.profileStats.found + input.profileStats.foundPartial >= input.displayThreshold) return false;
  return input.profileStats.checked < input.maxChecks - 2;
}

function resolveStoppedReason(input: {
  runtime: TargetAiSearchRuntime;
  displayCount: number;
  maxDisplayed: number;
  eligibleCount: number;
  targetEligibleCount: number;
  profileStats: TargetAiProfileVerifyStats;
  extractedUsernamesCount: number;
}) {
  if (input.runtime.stoppedReason) return input.runtime.stoppedReason;
  if (input.displayCount >= input.maxDisplayed) return "max_displayed_reached";
  if (input.eligibleCount >= input.targetEligibleCount) return "eligible_target_reached";
  if (input.runtime.isTimeExceeded()) return "time_budget_reached";
  if (input.runtime.isRateLimitHardStop()) return "rate_limit_hard_stop";
  if (input.extractedUsernamesCount === 0) return "insufficient_candidates";
  if (input.profileStats.checked >= input.runtime.limits.maxProfileChecks) return "insufficient_candidates";
  return `found_count=${input.profileStats.found + input.profileStats.foundPartial}`;
}

export async function searchTargetAccountsWithAiV1(input: {
  niche: string;
  location?: TargetAiSearchLocation | null;
  maxCandidates?: number;
}): Promise<TargetAiSearchResult> {
  const startedAt = Date.now();
  const activeConfig = await resolveActiveTargetingAiConfig();
  const config = {
    ...activeConfig,
    max_gpt_candidates: typeof input.maxCandidates === "number"
      ? Math.min(Math.max(input.maxCandidates, 12), 80)
      : activeConfig.max_gpt_candidates,
    max_searchapi_checks: Math.min(Math.max(activeConfig.max_searchapi_checks, 60), 100),
  };
  const runtimeLimits = readTargetAiSearchRuntimeLimits(config);
  const runtime = new TargetAiSearchRuntime(runtimeLimits, startedAt);

  const niche = input.niche.trim();
  const locationLabel = input.location?.label ?? null;
  const checked = new Set<string>();
  let secondPassUsed = false;
  let thirdPassUsed = false;
  let provider: "openai" | "mock" = "openai";
  let errorCode: string | null = null;
  let gptSearchQueriesCount = 0;
  let gptSeedUsernamesCount = 0;
  let searchapiDiscoveryQueriesCount = 0;
  let extractedUsernamesCount = 0;
  let duplicateSkippedCount = 0;
  let skippedLowScoreCount = 0;

  const profileStats = createTargetAiProfileVerifyStats();
  let verified: TargetAiSearchCandidate[] = [];

  async function executePass(
    pass: "primary" | "broadened" | "complementary",
    queryLimit: number,
    currentVerified: TargetAiSearchCandidate[],
  ) {
    if (runtime.isTimeExceeded()) return currentVerified;

    const discoveryPass = await runDiscoveryPass({
      niche,
      locationLabel,
      pass,
      config,
      runtime,
      queryLimit,
    });
    provider = discoveryPass.gpt.provider;
    if (!errorCode && discoveryPass.gpt.error_code) errorCode = discoveryPass.gpt.error_code;
    gptSearchQueriesCount += discoveryPass.queries.length;
    gptSeedUsernamesCount += discoveryPass.seedUsernames.length;
    searchapiDiscoveryQueriesCount += discoveryPass.discoveryQueriesExecuted;
    extractedUsernamesCount += discoveryPass.extractedUsernamesCount;
    duplicateSkippedCount += discoveryPass.duplicateSkippedCount;
    skippedLowScoreCount += discoveryPass.skippedLowScore;

    const remainingChecks = runtimeLimits.maxProfileChecks - profileStats.checked;
    if (remainingChecks <= 0) return currentVerified;
    if (discoveryPass.discoveryCandidates.length === 0 && discoveryPass.seedUsernames.length === 0) {
      return currentVerified;
    }

    const concurrency = readTargetAiProfileLookupConcurrency(
      config.searchapi_concurrency,
      runtime.rateLimitHits,
    );
    const passVerified = await verifyUsernames(
      discoveryPass.discoveryCandidates,
      discoveryPass.seedUsernames,
      concurrency,
      remainingChecks,
      checked,
      runtime,
      {
        maxDisplayedResults: config.max_displayed_results,
        targetEligibleCount: runtimeLimits.targetEligibleCount,
        currentVerified,
        niche,
        locationLabel,
      },
    );
    mergeProfileStats(profileStats, passVerified.stats);
    const merged = new Map<string, TargetAiSearchCandidate>();
    for (const row of passVerified.verified) merged.set(row.username, row);
    return [...merged.values()];
  }

  verified = await executePass("primary", runtimeLimits.primaryQueryLimit, []);

  if (verified.length === 0) {
    const mockUsernames = readTargetAiMockUsernames(config.max_gpt_candidates);
    if (mockUsernames.length > 0) {
      gptSeedUsernamesCount += mockUsernames.length;
      const mockVerified = await verifyUsernames(
        [],
        mockUsernames,
        1,
        runtimeLimits.maxProfileChecks,
        checked,
        runtime,
        {
          maxDisplayedResults: config.max_displayed_results,
          targetEligibleCount: runtimeLimits.targetEligibleCount,
          currentVerified: [],
          niche,
          locationLabel,
        },
      );
      mergeProfileStats(profileStats, mockVerified.stats);
      verified = mockVerified.verified;
    }
  }

  let displayCandidates = selectDisplayCandidates(verified, config.max_displayed_results);

  if (shouldRunBroadenedPass({
    displayCount: displayCandidates.length,
    profileStats,
    runtime,
    maxChecks: runtimeLimits.maxProfileChecks,
    secondPassEnabled: config.second_pass_enabled,
    displayThreshold: runtimeLimits.broadenedDisplayThreshold,
  })) {
    secondPassUsed = true;
    verified = await executePass("broadened", runtimeLimits.broadenedQueryLimit, verified);
    displayCandidates = selectDisplayCandidates(verified, config.max_displayed_results);
  }

  if (shouldRunThirdPass({
    displayCount: displayCandidates.length,
    profileStats,
    runtime,
    maxChecks: runtimeLimits.maxProfileChecks,
    thirdPassEnabled: runtimeLimits.thirdPassEnabled,
    displayThreshold: runtimeLimits.thirdPassDisplayThreshold,
  })) {
    thirdPassUsed = true;
    verified = await executePass("complementary", runtimeLimits.complementaryQueryLimit, verified);
    displayCandidates = selectDisplayCandidates(verified, config.max_displayed_results);
  }

  const avatarAvailableCount = displayCandidates.filter((row) => row.avatarAvailable).length;
  const relevanceScores = displayCandidates.map((row) => row.relevanceScore);
  const profileLookupConcurrency = readTargetAiProfileLookupConcurrency(
    config.searchapi_concurrency,
    runtime.rateLimitHits,
  );

  const debug: TargetAiSearchDebugSummary = {
    prompt_version: config.prompt_version,
    prompt_source: config.prompt_source,
    model: config.model,
    provider,
    niche_present: Boolean(niche),
    location_present: Boolean(locationLabel),
    max_displayed_results: config.max_displayed_results,
    max_searchapi_checks: runtimeLimits.maxProfileChecks,
    max_latency_ms: runtimeLimits.maxLatencyMs,
    profile_lookup_concurrency: profileLookupConcurrency,
    gpt_search_queries_count: gptSearchQueriesCount,
    gpt_seed_usernames_count: gptSeedUsernamesCount,
    searchapi_discovery_queries_count: searchapiDiscoveryQueriesCount,
    extracted_usernames_count: extractedUsernamesCount,
    profile_checked_count: profileStats.checked,
    profile_found_count: profileStats.found,
    profile_found_partial_count: profileStats.foundPartial,
    profile_not_found_count: profileStats.notFound,
    profile_provider_error_count: profileStats.providerError,
    profile_rate_limited_count: profileStats.rateLimited,
    profile_timeout_count: profileStats.timeout,
    profile_invalid_response_count: profileStats.invalidResponse,
    profile_skipped_low_score_count: skippedLowScoreCount,
    profile_retried_count: profileStats.retried,
    profile_skipped_count: profileStats.skipped,
    duplicate_skipped_count: duplicateSkippedCount + profileStats.duplicateSkipped,
    avatar_available_count: avatarAvailableCount,
    avatar_missing_count: displayCandidates.length - avatarAvailableCount,
    eligible_count: displayCandidates.filter((row) => row.eligible).length,
    ineligible_count: displayCandidates.filter((row) => !row.eligible).length,
    eligible_displayed_count: displayCandidates.filter((row) => row.eligible).length,
    ineligible_displayed_count: displayCandidates.filter((row) => !row.eligible).length,
    displayed_count: displayCandidates.length,
    final_results_count: displayCandidates.length,
    second_pass_used: secondPassUsed,
    third_pass_used: thirdPassUsed,
    stopped_reason: resolveStoppedReason({
      runtime,
      displayCount: displayCandidates.length,
      maxDisplayed: config.max_displayed_results,
      eligibleCount: displayCandidates.filter((row) => row.eligible).length,
      targetEligibleCount: runtimeLimits.targetEligibleCount,
      profileStats,
      extractedUsernamesCount,
    }),
    provider_error_reasons_top: topTargetAiProviderErrorReasons(profileStats),
    rejection_reasons_top: countReasons(displayCandidates),
    relevance_score_top: relevanceScores.length > 0 ? Math.max(...relevanceScores) : null,
    relevance_score_bottom: relevanceScores.length > 0 ? Math.min(...relevanceScores) : null,
    latency_ms: Date.now() - startedAt,
    error_code: errorCode,
    gpt_candidates_count: gptSeedUsernamesCount,
    searchapi_checked_count: profileStats.checked,
    found_count: profileStats.found + profileStats.foundPartial,
    not_found_count: profileStats.notFound,
  };

  safeLog("search_completed", debug);

  if (displayCandidates.length === 0) {
    return {
      status: "no_candidates",
      provider,
      candidates: [],
      suggested_count: gptSeedUsernamesCount + extractedUsernamesCount,
      verified_count: profileStats.checked,
      avatar_resolved: 0,
      error_code: errorCode || "no_candidates_found",
      debug,
    };
  }

  return {
    status: "ok",
    provider,
    candidates: displayCandidates,
    suggested_count: gptSeedUsernamesCount + extractedUsernamesCount,
    verified_count: profileStats.checked,
    avatar_resolved: avatarAvailableCount,
    error_code: errorCode,
    debug,
  };
}

export async function searchTargetAccountsWithAi(input: {
  accountId: string;
  niche: string;
  location?: TargetAiSearchLocation | null;
  maxCandidates?: number;
}): Promise<TargetAiSearchResult | import("./target-ai-search-v2-service.ts").TargetAiSearchV2Result> {
  const { isTargetAiV2Enabled, searchTargetAccountsWithAiV2 } = await import("./target-ai-search-v2-service.ts");
  if (isTargetAiV2Enabled()) {
    return searchTargetAccountsWithAiV2({
      accountId: input.accountId,
      niche: input.niche,
      location: input.location,
      maxCandidates: input.maxCandidates,
    });
  }
  return searchTargetAccountsWithAiV1({
    niche: input.niche,
    location: input.location,
    maxCandidates: input.maxCandidates,
  });
}
