import { evaluateTargetQuality } from "../instagram-target-quality.ts";
import {
  lookupInstagramPublicProfile,
  safeInstagramPublicMetadata,
  type InstagramPublicProfileLookupResult,
} from "../instagram-public-profile-lookup.ts";
import { targetDecisionFromLookup } from "../instagram-targets.ts";
import type { TargetAiSearchRuntime } from "./target-ai-search-runtime.ts";

export type TargetAiProfileVerifyErrorReason =
  | "not_found"
  | "rate_limited"
  | "provider_throttled"
  | "provider_timeout"
  | "provider_invalid_response"
  | "provider_http_error"
  | "provider_unavailable"
  | "username_invalid"
  | "provider_error";

export type TargetAiProfileVerifyStats = {
  checked: number;
  found: number;
  foundPartial: number;
  notFound: number;
  providerError: number;
  rateLimited: number;
  timeout: number;
  invalidResponse: number;
  skipped: number;
  skippedLowScore: number;
  duplicateSkipped: number;
  retried: number;
  errorReasons: Map<string, number>;
};

function readVerifyErrorReason(lookup: InstagramPublicProfileLookupResult): TargetAiProfileVerifyErrorReason {
  if (lookup.status === "not_found") return "not_found";
  if (lookup.status === "rate_limited") {
    return lookup.reason === "provider_throttled" ? "provider_throttled" : "rate_limited";
  }
  if (lookup.status === "unavailable") {
    return lookup.reason === "provider_timeout" ? "provider_timeout" : "provider_unavailable";
  }
  if (lookup.status === "username_invalid") return "username_invalid";
  if (lookup.reason === "provider_invalid_response") return "provider_invalid_response";
  if (lookup.reason.startsWith("provider_http_")) return "provider_http_error";
  return "provider_error";
}

function shouldRetryLookup(reason: TargetAiProfileVerifyErrorReason) {
  return reason === "rate_limited" || reason === "provider_throttled" || reason === "provider_timeout";
}

function recordErrorReason(stats: TargetAiProfileVerifyStats, reason: string) {
  stats.errorReasons.set(reason, (stats.errorReasons.get(reason) ?? 0) + 1);
}

export function createTargetAiProfileVerifyStats(): TargetAiProfileVerifyStats {
  return {
    checked: 0,
    found: 0,
    foundPartial: 0,
    notFound: 0,
    providerError: 0,
    rateLimited: 0,
    timeout: 0,
    invalidResponse: 0,
    skipped: 0,
    skippedLowScore: 0,
    duplicateSkipped: 0,
    retried: 0,
    errorReasons: new Map<string, number>(),
  };
}

export function readTargetAiProfileLookupConcurrency(configured: number, rateLimitHits = 0) {
  if (rateLimitHits >= 4) return 1;
  const parsed = Number.isFinite(configured) ? configured : 4;
  return Math.min(Math.max(parsed, 1), 2);
}

function isPartialFound(decision: ReturnType<typeof targetDecisionFromLookup>) {
  return decision.verification_status === "found"
    && (!decision.followers_count || !decision.avatar_url);
}

export async function verifyTargetAiProfileUsername(
  username: string,
  runtime?: TargetAiSearchRuntime,
) {
  if (runtime) {
    await runtime.waitForCooldown();
    if (runtime.isTimeExceeded()) runtime.markStopped("time_budget");
  }

  const lookup = await lookupInstagramPublicProfile(username);
  if (lookup.status === "username_invalid") {
    const decision = evaluateTargetQuality({
      verification_status: "username_invalid",
      normalized_username: username,
      provider_checked_at: lookup.checked_at,
      provider_error_reason: "username_invalid",
      metadata_safe: safeInstagramPublicMetadata({
        provider_status: lookup.status,
        reason: lookup.reason,
      }),
    });
    return {
      decision,
      lookup,
      errorReason: "username_invalid" as const,
      retried: false,
    };
  }

  let errorReason = readVerifyErrorReason(lookup);
  if (
    shouldRetryLookup(errorReason)
    && runtime?.canRetryProfileLookup()
    && !runtime.isTimeExceeded()
  ) {
    runtime.recordRateLimit();
    runtime.recordRetry();
    await new Promise((resolve) => setTimeout(resolve, runtime.limits.rateLimitCooldownMs));
    const retryLookup = await lookupInstagramPublicProfile(username, { disableCache: true });
    if (retryLookup.status === "found" || retryLookup.status === "not_found") {
      return {
        decision: targetDecisionFromLookup(retryLookup),
        lookup: retryLookup,
        errorReason: readVerifyErrorReason(retryLookup),
        retried: true,
      };
    }
    errorReason = readVerifyErrorReason(retryLookup);
    return {
      decision: targetDecisionFromLookup(retryLookup),
      lookup: retryLookup,
      errorReason,
      retried: true,
    };
  }

  if (errorReason === "rate_limited" || errorReason === "provider_throttled") {
    runtime?.recordRateLimit();
  }

  return {
    decision: targetDecisionFromLookup(lookup),
    lookup,
    errorReason,
    retried: false,
  };
}

export function applyTargetAiProfileVerifyStats(
  stats: TargetAiProfileVerifyStats,
  input: {
    errorReason: TargetAiProfileVerifyErrorReason;
    verificationStatus: string;
    retried?: boolean;
    partialFound?: boolean;
  },
) {
  stats.checked += 1;
  if (input.retried) stats.retried += 1;
  recordErrorReason(stats, input.errorReason);

  if (input.verificationStatus === "found") {
    if (input.partialFound) stats.foundPartial += 1;
    else stats.found += 1;
    return;
  }

  if (input.errorReason === "not_found") {
    stats.notFound += 1;
    return;
  }
  if (input.errorReason === "rate_limited" || input.errorReason === "provider_throttled") {
    stats.rateLimited += 1;
    return;
  }
  if (input.errorReason === "provider_timeout") {
    stats.timeout += 1;
    stats.providerError += 1;
    return;
  }
  if (input.errorReason === "provider_invalid_response") {
    stats.invalidResponse += 1;
    stats.providerError += 1;
    return;
  }
  stats.providerError += 1;
}

export function topTargetAiProviderErrorReasons(stats: TargetAiProfileVerifyStats, limit = 6) {
  return [...stats.errorReasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}
