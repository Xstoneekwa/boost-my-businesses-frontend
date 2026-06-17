import { mapWithConcurrency } from "../instagram-dashboard/target-provider-enrichment.ts";
import { normalizeTargetUsername, verifySingleTargetUsername } from "../instagram-targets.ts";
import { evaluateAiTargetEligibility } from "./target-ai-eligibility.ts";
import {
  buildTargetAiDiscoveryPrompt,
  readTargetAiMockUsernames,
  sanitizeTargetAiSuggestedUsernames,
  targetAiEnabled,
  targetAiModel,
} from "./target-ai-contract.ts";

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

export type TargetAiSearchResult = {
  status: "ok" | "ai_unavailable" | "no_candidates";
  provider: "openai" | "mock";
  candidates: TargetAiSearchCandidate[];
  suggested_count: number;
  verified_count: number;
  avatar_resolved: number;
  error_code: string | null;
};

function safeLog(event: string, fields: Record<string, unknown>) {
  console.info("[Target AI search]", { event, ...fields });
}

async function callOpenAiUsernames(input: {
  niche: string;
  locationLabel?: string | null;
  maxCandidates: number;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!targetAiEnabled() || !apiKey) {
    return { ok: false as const, usernames: readTargetAiMockUsernames(), provider: "mock" as const, error_code: "target_ai_disabled" as const };
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
        {
          role: "system",
          content: "You return strict JSON only.",
        },
        {
          role: "user",
          content: buildTargetAiDiscoveryPrompt(input),
        },
      ],
      temperature: 0.4,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    safeLog("openai_error", { status: response.status });
    return { ok: false as const, usernames: [], provider: "openai" as const, error_code: "target_ai_provider_error" as const };
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as unknown;
    const usernames = sanitizeTargetAiSuggestedUsernames(parsed, input.maxCandidates);
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

export async function searchTargetAccountsWithAi(input: {
  niche: string;
  location?: TargetAiSearchLocation | null;
  maxCandidates?: number;
}): Promise<TargetAiSearchResult> {
  const niche = input.niche.trim();
  const maxCandidates = Math.min(Math.max(input.maxCandidates ?? 10, 4), 15);
  const suggestionResult = await callOpenAiUsernames({
    niche,
    locationLabel: input.location?.label ?? null,
    maxCandidates,
  });

  const usernames = [...new Set(
    suggestionResult.usernames
      .map((username) => normalizeTargetUsername(username))
      .filter(Boolean),
  )].slice(0, maxCandidates);

  if (usernames.length === 0) {
    return {
      status: "no_candidates",
      provider: suggestionResult.provider,
      candidates: [],
      suggested_count: 0,
      verified_count: 0,
      avatar_resolved: 0,
      error_code: suggestionResult.error_code || "no_candidates_found",
    };
  }

  const verified = await mapWithConcurrency(usernames, 3, async (username) => {
    const decision = await verifySingleTargetUsername(username);
    return mapVerifiedCandidate(username, decision);
  });

  const avatarResolved = verified.filter((row) => row.avatarAvailable).length;
  safeLog("search_completed", {
    niche_present: Boolean(niche),
    location_present: Boolean(input.location?.label),
    suggested_count: usernames.length,
    verified_count: verified.length,
    avatar_present_count: avatarResolved,
    provider: suggestionResult.provider,
    found_count: verified.filter((row) => row.verificationStatus === "found").length,
  });

  return {
    status: verified.length > 0 ? "ok" : "no_candidates",
    provider: suggestionResult.provider,
    candidates: verified,
    suggested_count: usernames.length,
    verified_count: verified.length,
    avatar_resolved: avatarResolved,
    error_code: suggestionResult.ok ? null : suggestionResult.error_code,
  };
}
