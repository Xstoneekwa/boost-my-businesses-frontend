import { mapWithConcurrency } from "../instagram-dashboard/target-provider-enrichment.ts";
import { normalizeTargetUsername, verifySingleTargetUsername } from "../instagram-targets.ts";
import {
  buildTargetAiDiscoveryPrompt,
  buildTargetAiSystemPrompt,
  readTargetAiMockUsernames,
  sanitizeTargetAiDiscoveryResponse,
  targetingAiPromptVersion,
  targetAiEnabled,
  targetAiModel,
  type TargetAiDiscoveryPass,
} from "./target-ai-contract.ts";
import { evaluateAiTargetEligibility } from "./target-ai-eligibility.ts";
import { readTargetingAiSettings } from "./targeting-ai-settings.ts";

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

async function callOpenAiDiscovery(input: {
  niche: string;
  locationLabel?: string | null;
  maxCandidates: number;
  minFollowers: number;
  maxFollowers: number;
  allowVerified: boolean;
  temperature: number;
  pass: TargetAiDiscoveryPass;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!targetAiEnabled() || !apiKey) {
    return {
      ok: false as const,
      usernames: readTargetAiMockUsernames(input.maxCandidates),
      provider: "mock" as const,
      error_code: "target_ai_disabled" as const,
    };
  }

  const model = targetAiModel();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildTargetAiSystemPrompt() },
        {
          role: "user",
          content: buildTargetAiDiscoveryPrompt({
            niche: input.niche,
            locationLabel: input.locationLabel,
            maxCandidates: input.maxCandidates,
            minFollowers: input.minFollowers,
            maxFollowers: input.maxFollowers,
            allowVerified: input.allowVerified,
            pass: input.pass,
          }),
        },
      ],
      temperature: input.temperature,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    safeLog("openai_error", { status: response.status, pass: input.pass });
    return { ok: false as const, usernames: [], provider: "openai" as const, error_code: "target_ai_provider_error" as const };
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as unknown;
    const usernames = sanitizeTargetAiDiscoveryResponse(parsed, input.maxCandidates);
    if (usernames.length === 0) {
      return { ok: false as const, usernames: [], provider: "openai" as const, error_code: "no_candidates_found" as const };
    }
    return { ok: true as const, usernames, provider: "openai" as const, error_code: null };
  } catch {
    return { ok: false as const, usernames: [], provider: "openai" as const, error_code: "target_ai_provider_error" as const };
  }
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
  const settings = readTargetingAiSettings({
    maxGptCandidates: typeof input.maxCandidates === "number"
      ? Math.min(Math.max(input.maxCandidates, 12), 80)
      : undefined,
  });
  const niche = input.niche.trim();
  const locationLabel = input.location?.label ?? null;
  const checked = new Set<string>();
  let gptCandidatesCount = 0;
  let secondPassUsed = false;
  let provider: "openai" | "mock" = "openai";
  let errorCode: string | null = null;

  const primary = await callOpenAiDiscovery({
    niche,
    locationLabel,
    maxCandidates: settings.maxGptCandidates,
    minFollowers: settings.minFollowers,
    maxFollowers: settings.maxFollowers,
    allowVerified: settings.allowVerified,
    temperature: settings.temperature,
    pass: "primary",
  });
  provider = primary.provider;
  errorCode = primary.error_code;
  gptCandidatesCount += primary.usernames.length;

  let verified: TargetAiSearchCandidate[] = [];
  if (primary.usernames.length > 0) {
    verified = await verifyUsernames(
      primary.usernames,
      settings.searchApiConcurrency,
      settings.maxSearchApiChecks,
      checked,
    );
  }

  let eligibleCount = verified.filter((row) => row.eligible).length;
  const remainingChecks = settings.maxSearchApiChecks - checked.size;

  if (
    settings.secondPassEnabled
    && remainingChecks > 8
    && eligibleCount < settings.minEligibleTarget
    && primary.ok
  ) {
    secondPassUsed = true;
    const broadened = await callOpenAiDiscovery({
      niche,
      locationLabel,
      maxCandidates: Math.min(settings.maxGptCandidates, remainingChecks + 8),
      minFollowers: settings.minFollowers,
      maxFollowers: settings.maxFollowers,
      allowVerified: settings.allowVerified,
      temperature: settings.temperature,
      pass: "broadened",
    });
    if (broadened.usernames.length > 0) {
      gptCandidatesCount += broadened.usernames.length;
      const passVerified = await verifyUsernames(
        broadened.usernames,
        settings.searchApiConcurrency,
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

  const displayCandidates = selectDisplayCandidates(verified, settings.maxDisplayedResults);
  const foundCount = verified.filter((row) => row.verificationStatus === "found").length;
  const avatarResolved = displayCandidates.filter((row) => row.avatarAvailable).length;
  const debug: TargetAiSearchDebugSummary = {
    prompt_version: targetingAiPromptVersion(),
    model: settings.model,
    provider,
    niche_present: Boolean(niche),
    location_present: Boolean(locationLabel),
    gpt_candidates_count: gptCandidatesCount,
    searchapi_checked_count: checked.size,
    found_count: foundCount,
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
    avatar_resolved: avatarResolved,
    error_code: primary.ok ? null : errorCode,
    debug,
  };
}
