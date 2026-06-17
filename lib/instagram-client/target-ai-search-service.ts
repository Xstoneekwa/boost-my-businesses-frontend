import { mapWithConcurrency } from "../instagram-dashboard/target-provider-enrichment.ts";
import { normalizeTargetUsername, verifySingleTargetUsername } from "../instagram-targets.ts";
import { readTargetAiMockUsernames } from "./target-ai-contract.ts";
import { evaluateAiTargetEligibility } from "./target-ai-eligibility.ts";
import { callTargetAiOpenAiDiscovery } from "./targeting-ai-openai.ts";
import { resolveActiveTargetingAiConfig } from "./targeting-ai-config-store.ts";
import type { TargetingAiPromptSource } from "./targeting-ai-config-store.ts";

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
  gpt_candidates_count: number;
  searchapi_checked_count: number;
  found_count: number;
  eligible_count: number;
  ineligible_count: number;
  not_found_count: number;
  displayed_count: number;
  second_pass_used: boolean;
  rejection_reasons_top: Array<{ reason: string; count: number }>;
  latency_ms: number;
  error_code: string | null;
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

async function verifyUsernames(
  usernames: string[],
  concurrency: number,
  maxChecks: number,
  checked: Set<string>,
) {
  const queue = usernames
    .map((username) => normalizeTargetUsername(username))
    .filter((username): username is string => Boolean(username))
    .filter((username) => {
      if (checked.has(username)) return false;
      checked.add(username);
      return true;
    })
    .slice(0, maxChecks);

  return mapWithConcurrency(queue, concurrency, async (username) => {
    const decision = await verifySingleTargetUsername(username);
    return mapVerifiedCandidate(username, decision);
  });
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
  };

  const niche = input.niche.trim();
  const locationLabel = input.location?.label ?? null;
  const checked = new Set<string>();
  let gptCandidatesCount = 0;
  let secondPassUsed = false;
  let provider: "openai" | "mock" = "openai";
  let errorCode: string | null = null;

  const primary = await callTargetAiOpenAiDiscovery({
    config,
    niche,
    locationLabel,
    pass: "primary",
  });
  provider = primary.provider;
  errorCode = primary.error_code;
  gptCandidatesCount += primary.usernames.length;

  let verified: TargetAiSearchCandidate[] = [];
  if (primary.usernames.length > 0) {
    verified = await verifyUsernames(
      primary.usernames,
      config.searchapi_concurrency,
      config.max_searchapi_checks,
      checked,
    );
  } else if (!primary.ok && primary.provider === "mock") {
    const mockUsernames = readTargetAiMockUsernames(config.max_gpt_candidates);
    gptCandidatesCount += mockUsernames.length;
    if (mockUsernames.length > 0) {
      verified = await verifyUsernames(
        mockUsernames,
        config.searchapi_concurrency,
        config.max_searchapi_checks,
        checked,
      );
    }
  }

  let eligibleCount = verified.filter((row) => row.eligible).length;
  const remainingChecks = config.max_searchapi_checks - checked.size;

  if (
    config.second_pass_enabled
    && remainingChecks > 8
    && eligibleCount < config.min_eligible_target
    && (primary.ok || primary.provider === "openai")
  ) {
    secondPassUsed = true;
    const broadened = await callTargetAiOpenAiDiscovery({
      config: {
        ...config,
        max_gpt_candidates: Math.min(config.max_gpt_candidates, remainingChecks + 8),
      },
      niche,
      locationLabel,
      pass: "broadened",
    });
    if (broadened.usernames.length > 0) {
      gptCandidatesCount += broadened.usernames.length;
      const passVerified = await verifyUsernames(
        broadened.usernames,
        config.searchapi_concurrency,
        remainingChecks,
        checked,
      );
      const merged = new Map<string, TargetAiSearchCandidate>();
      for (const row of [...verified, ...passVerified]) merged.set(row.username, row);
      verified = [...merged.values()];
      eligibleCount = verified.filter((row) => row.eligible).length;
      if (!broadened.ok && !errorCode) errorCode = broadened.error_code;
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
    gpt_candidates_count: gptCandidatesCount,
    searchapi_checked_count: checked.size,
    found_count: verified.filter((row) => row.verificationStatus === "found").length,
    eligible_count: displayCandidates.filter((row) => row.eligible).length,
    ineligible_count: displayCandidates.filter((row) => !row.eligible).length,
    not_found_count: verified.filter((row) => row.ineligibleReasonCode === "not_found").length,
    displayed_count: displayCandidates.length,
    second_pass_used: secondPassUsed,
    rejection_reasons_top: countReasons(displayCandidates),
    latency_ms: Date.now() - startedAt,
    error_code: errorCode,
  };

  safeLog("search_completed", debug);

  if (displayCandidates.length === 0) {
    return {
      status: "no_candidates",
      provider,
      candidates: [],
      suggested_count: gptCandidatesCount,
      verified_count: checked.size,
      avatar_resolved: 0,
      error_code: errorCode || "no_candidates_found",
      debug,
    };
  }

  return {
    status: "ok",
    provider,
    candidates: displayCandidates,
    suggested_count: gptCandidatesCount,
    verified_count: checked.size,
    avatar_resolved: displayCandidates.filter((row) => row.avatarAvailable).length,
    error_code: primary.ok ? null : errorCode,
    debug,
  };
}
