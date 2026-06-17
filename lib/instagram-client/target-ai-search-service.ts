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
  readTargetAiDiscoveryLimits,
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
import { scoreTargetAiCandidateRelevance } from "./target-ai-relevance-score.ts";

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
  profile_lookup_concurrency: number;
  gpt_search_queries_count: number;
  gpt_seed_usernames_count: number;
  searchapi_discovery_queries_count: number;
  extracted_usernames_count: number;
  profile_checked_count: number;
  profile_found_count: number;
  profile_not_found_count: number;
  profile_provider_error_count: number;
  profile_rate_limited_count: number;
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
  provider_error_reasons_top: Array<{ reason: string; count: number }>;
  rejection_reasons_top: Array<{ reason: string; count: number }>;
  relevance_score_top: number | null;
  relevance_score_bottom: number | null;
  latency_ms: number;
  error_code: string | null;
  /** @deprecated use gpt_seed_usernames_count */
  gpt_candidates_count: number;
  /** @deprecated use profile_checked_count */
  searchapi_checked_count: number;
  /** @deprecated use profile_found_count */
  found_count: number;
  /** @deprecated use profile_not_found_count */
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
  const relevanceScore = scoreTargetAiCandidateRelevance({
    username,
    niche,
    locationLabel,
    profileName: readProfileText(lookup.metadata, "profile_name"),
    biography: readProfileText(lookup.metadata, "biography"),
  });
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
  const found = rankCandidates(candidates.filter((row) => row.verificationStatus === "found"));
  return found.slice(0, maxDisplayedResults);
}

function shouldStopProfileVerification(input: {
  verified: TargetAiSearchCandidate[];
  maxDisplayedResults: number;
}) {
  const found = input.verified.filter((row) => row.verificationStatus === "found");
  return found.length >= input.maxDisplayedResults;
}

function mergeProfileStats(target: TargetAiProfileVerifyStats, source: TargetAiProfileVerifyStats) {
  target.checked += source.checked;
  target.found += source.found;
  target.notFound += source.notFound;
  target.providerError += source.providerError;
  target.rateLimited += source.rateLimited;
  target.skipped += source.skipped;
  target.duplicateSkipped += source.duplicateSkipped;
  target.retried += source.retried;
  for (const [reason, count] of source.errorReasons.entries()) {
    target.errorReasons.set(reason, (target.errorReasons.get(reason) ?? 0) + count);
  }
}

async function verifyUsernames(
  usernames: string[],
  concurrency: number,
  maxChecks: number,
  checked: Set<string>,
  stopWhen: {
    maxDisplayedResults: number;
    currentVerified: TargetAiSearchCandidate[];
    niche: string;
    locationLabel: string | null;
  },
) {
  const stats = createTargetAiProfileVerifyStats();

  const queue = usernames
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
    const result = await verifyTargetAiProfileUsername(username);
    const candidate = mapVerifiedCandidate(
      username,
      result.decision,
      result.lookup,
      stopWhen.niche,
      stopWhen.locationLabel,
    );
    verified.push(candidate);
    applyTargetAiProfileVerifyStats(stats, {
      errorReason: result.errorReason,
      verificationStatus: candidate.verificationStatus,
      retried: result.retried,
    });

    if (result.errorReason !== "not_found" && result.errorReason !== "username_invalid") {
      safeLog("profile_lookup_issue", {
        username,
        reason: result.errorReason,
        verification_status: candidate.verificationStatus,
        retried: Boolean(result.retried),
        endpoint: "instagram_profile",
      });
    }

    if (shouldStopProfileVerification({
      verified,
      maxDisplayedResults: stopWhen.maxDisplayedResults,
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
}) {
  const { discovery } = input;
  safeLog("gpt_discovery", {
    pass: input.pass,
    search_queries_count: discovery.searchQueries.length,
    search_queries_sample: discovery.searchQueries.slice(0, 4).map((query) => query.slice(0, 120)),
    keywords_count: discovery.searchAngles.reduce((sum, angle) => sum + angle.keywords.length, 0),
    hashtag_hints_count: discovery.searchAngles.reduce((sum, angle) => sum + angle.hashtagHints.length, 0),
    seed_usernames_count: discovery.usernames.length,
    niche_variants_count: discovery.nicheVariants.length,
  });
}

async function runDiscoveryPass(input: {
  niche: string;
  locationLabel?: string | null;
  pass: "primary" | "broadened" | "complementary";
  config: Awaited<ReturnType<typeof resolveActiveTargetingAiConfig>>;
}) {
  const limits = readTargetAiDiscoveryLimits();
  const gpt = await callTargetAiOpenAiDiscovery({
    config: input.config,
    niche: input.niche,
    locationLabel: input.locationLabel,
    pass: input.pass === "complementary" ? "broadened" : input.pass,
  });

  logGptDiscovery({ discovery: gpt.discovery, pass: input.pass });

  const queries = buildTargetAiDiscoveryQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
    discovery: gpt.discovery,
    pass: input.pass === "complementary" ? "broadened" : input.pass,
    maxQueries: limits.maxDiscoveryQueries,
  });

  let discovery = {
    usernames: [] as string[],
    queriesExecuted: 0,
    duplicateSkippedCount: 0,
    extractedUsernamesCount: 0,
  };

  if (isTargetAiSearchApiDiscoveryConfigured() && queries.length > 0) {
    const searchResult = await discoverInstagramUsernamesViaSearchApi({
      queries,
      maxUsernames: limits.maxDiscoveredUsernames,
    });
    discovery = {
      usernames: searchResult.usernames,
      queriesExecuted: searchResult.queriesExecuted,
      duplicateSkippedCount: searchResult.duplicateSkippedCount,
      extractedUsernamesCount: searchResult.extractedUsernamesCount,
    };
    safeLog("searchapi_discovery", {
      pass: input.pass,
      queries_executed: searchResult.queriesExecuted,
      queries_succeeded: searchResult.queriesSucceeded,
      queries_failed: searchResult.queriesFailed,
      organic_results_scanned: searchResult.organicResultsScanned,
      extracted_usernames_count: searchResult.extractedUsernamesCount,
    });
  } else if (!isTargetAiSearchApiDiscoveryConfigured()) {
    safeLog("searchapi_discovery_skipped", {
      pass: input.pass,
      reason: "searchapi_not_configured",
    });
  }

  const merged = mergeDiscoveredUsernames(
    [discovery.usernames, gpt.usernames],
    limits.maxDiscoveredUsernames,
  );

  return {
    gpt,
    queries,
    candidateUsernames: merged.usernames,
    duplicateSkippedCount: merged.duplicateSkipped + discovery.duplicateSkippedCount,
    discoveryQueriesExecuted: discovery.queriesExecuted,
    extractedUsernamesCount: discovery.extractedUsernamesCount,
  };
}

function shouldRunThirdPass(input: {
  displayedCount: number;
  maxDisplayedResults: number;
  profileStats: TargetAiProfileVerifyStats;
  maxSearchApiChecks: number;
}) {
  const targetFloor = Math.min(20, Math.max(12, Math.floor(input.maxDisplayedResults * 0.66)));
  if (input.displayedCount >= targetFloor) return false;
  if (input.profileStats.found >= input.maxDisplayedResults) return false;
  if (input.profileStats.checked >= input.maxSearchApiChecks - 8) return false;
  return true;
}

export async function searchTargetAccountsWithAi(input: {
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
  const profileLookupConcurrency = readTargetAiProfileLookupConcurrency(config.searchapi_concurrency);

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

  const profileStats = createTargetAiProfileVerifyStats();

  async function runPass(
    pass: "primary" | "broadened" | "complementary",
    currentVerified: TargetAiSearchCandidate[],
    maxChecks: number,
  ) {
    const discoveryPass = await runDiscoveryPass({
      niche,
      locationLabel,
      pass,
      config,
    });
    gptSearchQueriesCount += discoveryPass.queries.length;
    gptSeedUsernamesCount += discoveryPass.gpt.usernames.length;
    searchapiDiscoveryQueriesCount += discoveryPass.discoveryQueriesExecuted;
    extractedUsernamesCount += discoveryPass.extractedUsernamesCount;
    duplicateSkippedCount += discoveryPass.duplicateSkippedCount;
    if (!errorCode && discoveryPass.gpt.error_code) errorCode = discoveryPass.gpt.error_code;
    provider = discoveryPass.gpt.provider;

    if (discoveryPass.candidateUsernames.length === 0) {
      return currentVerified;
    }

    const passVerified = await verifyUsernames(
      discoveryPass.candidateUsernames,
      profileLookupConcurrency,
      maxChecks,
      checked,
      {
        maxDisplayedResults: config.max_displayed_results,
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

  let verified: TargetAiSearchCandidate[] = [];

  const primaryDiscovery = await runDiscoveryPass({ niche, locationLabel, pass: "primary", config });
  provider = primaryDiscovery.gpt.provider;
  errorCode = primaryDiscovery.gpt.error_code;
  gptSearchQueriesCount += primaryDiscovery.queries.length;
  gptSeedUsernamesCount += primaryDiscovery.gpt.usernames.length;
  searchapiDiscoveryQueriesCount += primaryDiscovery.discoveryQueriesExecuted;
  extractedUsernamesCount += primaryDiscovery.extractedUsernamesCount;
  duplicateSkippedCount += primaryDiscovery.duplicateSkippedCount;

  let candidateUsernames = primaryDiscovery.candidateUsernames;
  if (candidateUsernames.length === 0) {
    const mockUsernames = readTargetAiMockUsernames(config.max_gpt_candidates);
    candidateUsernames = mockUsernames;
    gptSeedUsernamesCount += mockUsernames.length;
  }

  if (candidateUsernames.length > 0) {
    const passVerified = await verifyUsernames(
      candidateUsernames,
      profileLookupConcurrency,
      config.max_searchapi_checks,
      checked,
      {
        maxDisplayedResults: config.max_displayed_results,
        currentVerified: [],
        niche,
        locationLabel,
      },
    );
    mergeProfileStats(profileStats, passVerified.stats);
    verified = passVerified.verified;
  }

  let displayCandidates = selectDisplayCandidates(verified, config.max_displayed_results);
  let remainingChecks = config.max_searchapi_checks - profileStats.checked;

  if (
    config.second_pass_enabled
    && remainingChecks > 8
    && displayCandidates.length < config.max_displayed_results
    && profileStats.found < config.max_displayed_results
  ) {
    secondPassUsed = true;
    verified = await runPass("broadened", verified, remainingChecks);
    displayCandidates = selectDisplayCandidates(verified, config.max_displayed_results);
    remainingChecks = config.max_searchapi_checks - profileStats.checked;
  }

  if (
    shouldRunThirdPass({
      displayedCount: displayCandidates.length,
      maxDisplayedResults: config.max_displayed_results,
      profileStats,
      maxSearchApiChecks: config.max_searchapi_checks,
    })
    && remainingChecks > 8
  ) {
    thirdPassUsed = true;
    verified = await runPass("complementary", verified, remainingChecks);
    displayCandidates = selectDisplayCandidates(verified, config.max_displayed_results);
  }

  const avatarAvailableCount = displayCandidates.filter((row) => row.avatarAvailable).length;
  const relevanceScores = displayCandidates.map((row) => row.relevanceScore);
  const debug: TargetAiSearchDebugSummary = {
    prompt_version: config.prompt_version,
    prompt_source: config.prompt_source,
    model: config.model,
    provider,
    niche_present: Boolean(niche),
    location_present: Boolean(locationLabel),
    max_displayed_results: config.max_displayed_results,
    max_searchapi_checks: config.max_searchapi_checks,
    profile_lookup_concurrency: profileLookupConcurrency,
    gpt_search_queries_count: gptSearchQueriesCount,
    gpt_seed_usernames_count: gptSeedUsernamesCount,
    searchapi_discovery_queries_count: searchapiDiscoveryQueriesCount,
    extracted_usernames_count: extractedUsernamesCount,
    profile_checked_count: profileStats.checked,
    profile_found_count: profileStats.found,
    profile_not_found_count: profileStats.notFound,
    profile_provider_error_count: profileStats.providerError,
    profile_rate_limited_count: profileStats.rateLimited,
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
    provider_error_reasons_top: topTargetAiProviderErrorReasons(profileStats),
    rejection_reasons_top: countReasons(displayCandidates),
    relevance_score_top: relevanceScores.length > 0 ? Math.max(...relevanceScores) : null,
    relevance_score_bottom: relevanceScores.length > 0 ? Math.min(...relevanceScores) : null,
    latency_ms: Date.now() - startedAt,
    error_code: errorCode,
    gpt_candidates_count: gptSeedUsernamesCount,
    searchapi_checked_count: profileStats.checked,
    found_count: profileStats.found,
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
