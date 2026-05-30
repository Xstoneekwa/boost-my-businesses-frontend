import type { TargetVerificationDecision } from "./instagram-targets.ts";

export type TargetVerificationJobStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "skipped"
  | "retry_scheduled";

export type TargetVerificationJobTarget = {
  id?: string | null;
  target_id?: string | null;
  account_id?: string | null;
  batch_id?: string | null;
  normalized_username?: string | null;
  target_username?: string | null;
};

export type TargetVerificationJobPayload = {
  target_id: string;
  account_id: string;
  batch_id: string | null;
  normalized_username: string;
  status: "pending";
};

export type TargetVerificationJobDecision = {
  jobStatus: TargetVerificationJobStatus;
  targetPatch: {
    status: TargetVerificationDecision["status"];
    verification_status: TargetVerificationDecision["verification_status"];
    verification_reason: string;
    quality_status: TargetVerificationDecision["quality_status"];
    canonical_username: string | null;
    avatar_url: string | null;
    followers_count: number | null;
    is_verified: boolean | null;
    is_private: boolean | null;
    provider_checked_at: string | null;
    rejected_reason: string | null;
    metadata_safe: Record<string, string | number | boolean | null>;
  };
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  auditResult: "accepted" | "rejected" | "review" | "failed";
  auditReason: string;
};

const retryableVerificationStatuses = new Set(["rate_limited", "unavailable", "provider_error"]);

function safeReason(value: string | null | undefined, fallback = "unknown") {
  return (value || fallback).trim().toLowerCase().replace(/[^a-z0-9_:-]/g, "_").slice(0, 120) || fallback;
}

function safeMessage(value: string | null | undefined, fallback = "verification_retry_scheduled") {
  return (value || fallback).trim().replace(/[\r\n\t]/g, " ").slice(0, 240) || fallback;
}

export function buildTargetVerificationJobPayload(row: TargetVerificationJobTarget): TargetVerificationJobPayload | null {
  const targetId = (row.target_id || row.id || "").trim();
  const accountId = (row.account_id || "").trim();
  const normalizedUsername = (row.normalized_username || row.target_username || "").trim().toLowerCase();

  if (!targetId || !accountId || !normalizedUsername) return null;

  return {
    target_id: targetId,
    account_id: accountId,
    batch_id: row.batch_id || null,
    normalized_username: normalizedUsername,
    status: "pending",
  };
}

export function buildTargetVerificationJobPayloads(rows: TargetVerificationJobTarget[]) {
  const seen = new Set<string>();
  const payloads: TargetVerificationJobPayload[] = [];

  for (const row of rows) {
    const payload = buildTargetVerificationJobPayload(row);
    if (!payload || seen.has(payload.target_id)) continue;
    seen.add(payload.target_id);
    payloads.push(payload);
  }

  return payloads;
}

export function isRetryableTargetVerificationDecision(decision: TargetVerificationDecision) {
  return (
    retryableVerificationStatuses.has(decision.verification_status) ||
    decision.verification_reason === "provider_not_configured" ||
    decision.quality_status === "review_provider_unavailable"
  );
}

export function nextVerificationAttemptAt(now: Date, attemptCount: number) {
  const safeAttempt = Math.max(1, attemptCount);
  const delayMinutes = Math.min(60, 5 * 2 ** (safeAttempt - 1));
  return new Date(now.getTime() + delayMinutes * 60_000).toISOString();
}

export function buildTargetVerificationJobDecision(input: {
  decision: TargetVerificationDecision;
  attemptCount: number;
  maxAttempts: number;
  now: Date;
}): TargetVerificationJobDecision {
  const { decision, attemptCount, maxAttempts, now } = input;
  const retryable = isRetryableTargetVerificationDecision(decision);
  const canRetry = retryable && attemptCount < maxAttempts;
  const transientReason = safeReason(decision.verification_reason, decision.verification_status);

  if (canRetry) {
    return {
      jobStatus: "retry_scheduled",
      targetPatch: {
        status: "pending_verification",
        verification_status: decision.verification_status,
        verification_reason: transientReason,
        quality_status: "unknown",
        canonical_username: decision.canonical_username,
        avatar_url: decision.avatar_url,
        followers_count: decision.followers_count,
        is_verified: decision.is_verified,
        is_private: decision.is_private,
        provider_checked_at: decision.provider_checked_at,
        rejected_reason: null,
        metadata_safe: decision.metadata_safe,
      },
      nextAttemptAt: nextVerificationAttemptAt(now, attemptCount),
      lastErrorCode: transientReason,
      lastErrorMessage: safeMessage(decision.verification_reason, "verification_retry_scheduled"),
      auditResult: "failed",
      auditReason: "verification_retry_scheduled",
    };
  }

  const finalDecision: TargetVerificationDecision = retryable
    ? {
        ...decision,
        status: "review",
        quality_status: "review_provider_unavailable",
        rejected_reason: null,
      }
    : decision;

  return {
    jobStatus: finalDecision.status === "valid" || finalDecision.status === "rejected" || finalDecision.status === "review"
      ? "succeeded"
      : "failed",
    targetPatch: {
      status: finalDecision.status,
      verification_status: finalDecision.verification_status,
      verification_reason: safeReason(finalDecision.verification_reason, finalDecision.verification_status),
      quality_status: finalDecision.quality_status,
      canonical_username: finalDecision.canonical_username,
      avatar_url: finalDecision.avatar_url,
      followers_count: finalDecision.followers_count,
      is_verified: finalDecision.is_verified,
      is_private: finalDecision.is_private,
      provider_checked_at: finalDecision.provider_checked_at,
      rejected_reason: finalDecision.rejected_reason,
      metadata_safe: finalDecision.metadata_safe,
    },
    nextAttemptAt: null,
    lastErrorCode: retryable ? transientReason : null,
    lastErrorMessage: retryable ? safeMessage(finalDecision.verification_reason, "max_attempts_reached") : null,
    auditResult: finalDecision.status === "valid"
      ? "accepted"
      : finalDecision.status === "rejected"
        ? "rejected"
        : finalDecision.status === "review"
          ? "review"
          : "failed",
    auditReason: finalDecision.verification_reason,
  };
}

export function emptyVerificationBatchSummary() {
  return {
    jobs_processed: 0,
    succeeded: 0,
    rejected: 0,
    review: 0,
    retry_scheduled: 0,
    skipped: 0,
    rate_limited: 0,
    provider_error: 0,
  };
}
