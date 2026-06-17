import { mapWithConcurrency } from "../instagram-dashboard/target-provider-enrichment.ts";
import { normalizeTargetUsername, verifySingleTargetUsername } from "../instagram-targets.ts";
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
};

export type TargetAiSearchDebugSummary = {
  prompt_version: string;
  prompt_source: TargetingAiPromptSource;
  model: string;
  provider: "openai" | "mock";
  niche_present: boolean;
  location_present: boolean;
  gpt_search_queries_count: number;
  gpt_seed_usernames_count: number;
  searchapi_discovery_queries_count: number;
  extracted_usernames_count: number;
  profile_checked_count: number;
  profile_found_count: number;
  profile_not_found_count: number;
  profile_provider_error_count: number;
  profile_skipped_count: number;
  duplicate_skipped_count: number;
  eligible_count: number;
  ineligible_count: number;
  displayed_count: number;
  second_pass_used: boolean;
  rejection_reasons_top: Array<{ reason: string; count: number }>;
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

type ProfileVerifyStats = {
  checked: number;
  found: number;
  notFound: number;
  providerError: number;
  skipped: number;
  duplicateSkipped: number;
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

function mapVerifiedCandidate(username: string, decision: Awaited<ReturnType<typeof verifySingleTargetUsername>>): TargetAiSearchCandidate {
  const eligibility = evaluateAiTargetEligibility({
    quality_status: decision.quality_status,
    status: decision.status,
    followers_count: decision.followers_count,
    is_verified: decision.is_verified,
    is_private: decision.is_private,
    verification_status: decision.verification_status,
  });
  const avatarUrl = decision.avatar_url ?? null;
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
  };
}

function rankCandidates(candidates: TargetAiSearchCandidate[]) {
  return [...candidates].sort((left, right) => {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    const leftFollowers = left.followersCount ?? -1;
    const rightFollowers = right.followersCount ?? -1;
    return rightFollowers - leftFollowers;
  });
}

function selectDisplayCandidates(candidates: TargetAiSearchCandidate[], maxDisplayedResults: number) {
  const found = rankCandidates(candidates.filter((row) => row.verificationStatus === "found"));
  return found.slice(0, maxDisplayedResults);
}

function classifyVerificationStatus(status: string) {
  if (status === "found") return "found" as const;
  if (status === "not_found") return "not_found" as const;
  return "provider_error" as const;
}

function shouldStopProfileVerification(input: {
  verified: TargetAiSearchCandidate[];
  maxDisplayedResults: number;
  minEligibleTarget: number;
}) {
  const found = input.verified.filter((row) => row.verificationStatus === "found");
  const eligible = found.filter((row) => row.eligible);
  if (found.length >= input.maxDisplayedResults) return true;
  if (eligible.length >= input.minEligibleTarget) return true;
  return false;
}

async function verifyUsernames(
  usernames: string[],
  concurrency: number,
  maxChecks: number,
  checked: Set<string>,
  stopWhen: {
    maxDisplayedResults: number;
    minEligibleTarget: number;
    currentVerified: TargetAiSearchCandidate[];
  },
) {
  const stats: ProfileVerifyStats = {
    checked: 0,
    found: 0,
    notFound: 0,
    providerError: 0,
    skipped: 0,
    duplicateSkipped: 0,
  };

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
    const decision = await verifySingleTargetUsername(username);
    const candidate = mapVerifiedCandidate(username, decision);
    verified.push(candidate);
    stats.checked += 1;

    const bucket = classifyVerificationStatus(candidate.verificationStatus);
    if (bucket === "found") stats.found += 1;
    else if (bucket === "not_found") stats.notFound += 1;
    else stats.providerError += 1;

    if (shouldStopProfileVerification({
      verified,
      maxDisplayedResults: stopWhen.maxDisplayedResults,
      minEligibleTarget: stopWhen.minEligibleTarget,
    })) {
      stopEarly = true;
    }

    return candidate;
  });

  return { verified, stats };
}

function logGptDiscovery(input: {
  discovery: Awaited<ReturnType<typeof callTargetAiOpenAiDiscovery>>["discovery"];
  pass: "primary" | "broadened";
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
  pass: "primary" | "broadened";
  config: Awaited<ReturnType<typeof resolveActiveTargetingAiConfig>>;
}) {
  const limits = readTargetAiDiscoveryLimits();
  const gpt = await callTargetAiOpenAiDiscovery({
    config: input.config,
    niche: input.niche,
    locationLabel: input.locationLabel,
    pass: input.pass,
  });

  logGptDiscovery({ discovery: gpt.discovery, pass: input.pass });

  const queries = buildTargetAiDiscoveryQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
    discovery: gpt.discovery,
    pass: input.pass,
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
      concurrency: input.config.searchapi_concurrency,
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
    max_searchapi_checks: Math.min(Math.max(activeConfig.max_searchapi_checks, 50), 70),
  };

  const niche = input.niche.trim();
  const locationLabel = input.location?.label ?? null;
  const checked = new Set<string>();
  let secondPassUsed = false;
  let provider: "openai" | "mock" = "openai";
  let errorCode: string | null = null;
  let gptSearchQueriesCount = 0;
  let gptSeedUsernamesCount = 0;
  let searchapiDiscoveryQueriesCount = 0;
  let extractedUsernamesCount = 0;
  let duplicateSkippedCount = 0;

  const profileStats: ProfileVerifyStats = {
    checked: 0,
    found: 0,
    notFound: 0,
    providerError: 0,
    skipped: 0,
    duplicateSkipped: 0,
  };

  const primary = await runDiscoveryPass({
    niche,
    locationLabel,
    pass: "primary",
    config,
  });
  provider = primary.gpt.provider;
  errorCode = primary.gpt.error_code;
  gptSearchQueriesCount += primary.queries.length;
  gptSeedUsernamesCount += primary.gpt.usernames.length;
  searchapiDiscoveryQueriesCount += primary.discoveryQueriesExecuted;
  extractedUsernamesCount += primary.extractedUsernamesCount;
  duplicateSkippedCount += primary.duplicateSkippedCount;

  let verified: TargetAiSearchCandidate[] = [];
  let candidateUsernames = primary.candidateUsernames;

  if (candidateUsernames.length === 0 && !primary.gpt.ok && primary.gpt.provider === "mock") {
    const mockUsernames = readTargetAiMockUsernames(config.max_gpt_candidates);
    candidateUsernames = mockUsernames;
    gptSeedUsernamesCount += mockUsernames.length;
  }

  if (candidateUsernames.length > 0) {
    const passVerified = await verifyUsernames(
      candidateUsernames,
      config.searchapi_concurrency,
      config.max_searchapi_checks,
      checked,
      {
        maxDisplayedResults: config.max_displayed_results,
        minEligibleTarget: config.min_eligible_target,
        currentVerified: [],
      },
    );
    verified = passVerified.verified;
    profileStats.checked += passVerified.stats.checked;
    profileStats.found += passVerified.stats.found;
    profileStats.notFound += passVerified.stats.notFound;
    profileStats.providerError += passVerified.stats.providerError;
    profileStats.skipped += passVerified.stats.skipped;
    profileStats.duplicateSkipped += passVerified.stats.duplicateSkipped;
  }

  let eligibleCount = verified.filter((row) => row.eligible).length;
  const remainingChecks = config.max_searchapi_checks - profileStats.checked;

  if (
    config.second_pass_enabled
    && remainingChecks > 8
    && eligibleCount < config.min_eligible_target
    && selectDisplayCandidates(verified, config.max_displayed_results).length < config.max_displayed_results
    && (primary.gpt.ok || primary.gpt.provider === "openai")
  ) {
    secondPassUsed = true;
    const broadened = await runDiscoveryPass({
      niche,
      locationLabel,
      pass: "broadened",
      config: {
        ...config,
        max_gpt_candidates: Math.min(config.max_gpt_candidates, remainingChecks + 8),
      },
    });
    gptSearchQueriesCount += broadened.queries.length;
    gptSeedUsernamesCount += broadened.gpt.usernames.length;
    searchapiDiscoveryQueriesCount += broadened.discoveryQueriesExecuted;
    extractedUsernamesCount += broadened.extractedUsernamesCount;
    duplicateSkippedCount += broadened.duplicateSkippedCount;

    if (broadened.candidateUsernames.length > 0) {
      const passVerified = await verifyUsernames(
        broadened.candidateUsernames,
        config.searchapi_concurrency,
        remainingChecks,
        checked,
        {
          maxDisplayedResults: config.max_displayed_results,
          minEligibleTarget: config.min_eligible_target,
          currentVerified: verified,
        },
      );
      const merged = new Map<string, TargetAiSearchCandidate>();
      for (const row of passVerified.verified) merged.set(row.username, row);
      verified = [...merged.values()];
      profileStats.checked += passVerified.stats.checked;
      profileStats.found += passVerified.stats.found;
      profileStats.notFound += passVerified.stats.notFound;
      profileStats.providerError += passVerified.stats.providerError;
      profileStats.skipped += passVerified.stats.skipped;
      profileStats.duplicateSkipped += passVerified.stats.duplicateSkipped;
      eligibleCount = verified.filter((row) => row.eligible).length;
      if (!broadened.gpt.ok && !errorCode) errorCode = broadened.gpt.error_code;
    }
  }

  const displayCandidates = selectDisplayCandidates(verified, config.max_displayed_results);
  const debug: TargetAiSearchDebugSummary = {
    prompt_version: config.prompt_version,
    prompt_source: config.prompt_source,
    model: config.model,
    provider,
    niche_present: Boolean(niche),
    location_present: Boolean(locationLabel),
    gpt_search_queries_count: gptSearchQueriesCount,
    gpt_seed_usernames_count: gptSeedUsernamesCount,
    searchapi_discovery_queries_count: searchapiDiscoveryQueriesCount,
    extracted_usernames_count: extractedUsernamesCount,
    profile_checked_count: profileStats.checked,
    profile_found_count: profileStats.found,
    profile_not_found_count: profileStats.notFound,
    profile_provider_error_count: profileStats.providerError,
    profile_skipped_count: profileStats.skipped,
    duplicate_skipped_count: duplicateSkippedCount + profileStats.duplicateSkipped,
    eligible_count: displayCandidates.filter((row) => row.eligible).length,
    ineligible_count: displayCandidates.filter((row) => !row.eligible).length,
    displayed_count: displayCandidates.length,
    second_pass_used: secondPassUsed,
    rejection_reasons_top: countReasons(displayCandidates),
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
    avatar_resolved: displayCandidates.filter((row) => row.avatarAvailable).length,
    error_code: primary.gpt.ok ? null : errorCode,
    debug,
  };
}
