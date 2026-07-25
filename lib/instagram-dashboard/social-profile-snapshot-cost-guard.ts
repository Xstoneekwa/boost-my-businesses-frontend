import { normalizeSocialProfileUsername } from "./social-profile-snapshot-contract.ts";

export const SOCIAL_PROFILE_SNAPSHOT_FRESH_HOURS = 36;
export const SOCIAL_PROFILE_SNAPSHOT_ADMIN_REFRESH_COOLDOWN_HOURS = 6;

export type SocialProfileSnapshotGuardClassification =
  | "skipped_fresh"
  | "retryable_backoff"
  | "existing_job_pending"
  | "terminal_suppressed"
  | "enqueue_allowed"
  | "enqueued";

export type SocialProfileSnapshotGuardResult = {
  classification: SocialProfileSnapshotGuardClassification;
  reason: string;
  jobId: string | null;
  jobStatus: string | null;
  created: boolean;
  providerCallsNewJobMax: number;
  existingRetryProviderCallsMax: number;
  retryDue: boolean;
};

export type SocialProfileSnapshotGuardJob = {
  id?: string | null;
  username_normalized?: string | null;
  status?: string | null;
  attempts?: number | null;
  available_at?: string | null;
  last_error_code?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const TERMINAL_CODES = new Set(["not_found", "invalid_username", "profile_unavailable"]);

function timestamp(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function isSuppressibleSocialProfileTerminalError(value: unknown) {
  const code = String(value ?? "").trim().toLowerCase();
  return TERMINAL_CODES.has(code) || code.startsWith("retry_exhausted:");
}

function result(
  classification: SocialProfileSnapshotGuardClassification,
  reason: string,
  job: SocialProfileSnapshotGuardJob | null = null,
  existingRetryProviderCallsMax = 0,
  retryDue = false,
): SocialProfileSnapshotGuardResult {
  return {
    classification,
    reason,
    jobId: String(job?.id ?? "") || null,
    jobStatus: String(job?.status ?? "") || null,
    created: false,
    providerCallsNewJobMax: classification === "enqueue_allowed" || classification === "enqueued" ? 1 : 0,
    existingRetryProviderCallsMax,
    retryDue,
  };
}

export function classifySocialProfileSnapshotCostGuard(input: {
  username: unknown;
  now: Date;
  latestSuccessfulSnapshotAt?: string | null;
  jobs?: SocialProfileSnapshotGuardJob[];
  explicitAdminRefresh?: boolean;
}) {
  const username = normalizeSocialProfileUsername(input.username);
  const nowMs = input.now.getTime();
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    return result("terminal_suppressed", "invalid_username");
  }

  const latestSuccessMs = timestamp(input.latestSuccessfulSnapshotAt);
  const matchingJobs = (input.jobs ?? [])
    .filter((job) => normalizeSocialProfileUsername(job.username_normalized) === username)
    .sort((left, right) => timestamp(right.updated_at ?? right.created_at) - timestamp(left.updated_at ?? left.created_at));

  if (!input.explicitAdminRefresh
      && latestSuccessMs !== Number.NEGATIVE_INFINITY
      && latestSuccessMs >= nowMs - SOCIAL_PROFILE_SNAPSHOT_FRESH_HOURS * 60 * 60 * 1000) {
    return result("skipped_fresh", "modern_snapshot_within_36h");
  }

  const active = matchingJobs.find((job) => job.status === "queued" || job.status === "processing");
  if (active) {
    const attempts = Math.max(0, Number(active.attempts ?? 0));
    const availableMs = timestamp(active.available_at);
    if (attempts >= 3) return result("terminal_suppressed", "retry_exhausted_existing_job", active);
    if (active.status === "queued" && attempts > 0 && availableMs > nowMs) {
      return result("retryable_backoff", "existing_retry_backoff", active);
    }
    const retryDue = active.status === "queued" && availableMs <= nowMs;
    return result(
      "existing_job_pending",
      active.status === "processing" ? "existing_job_processing" : "existing_job_due",
      active,
      retryDue ? 1 : 0,
      retryDue,
    );
  }

  if (!input.explicitAdminRefresh) {
    const terminal = matchingJobs.find((job) => job.status === "failed" && isSuppressibleSocialProfileTerminalError(job.last_error_code));
    if (terminal && (latestSuccessMs === Number.NEGATIVE_INFINITY || timestamp(terminal.updated_at ?? terminal.created_at) > latestSuccessMs)) {
      return result("terminal_suppressed", "latest_terminal_failure_for_current_username", terminal);
    }
  }

  return result("enqueue_allowed", input.explicitAdminRefresh ? "explicit_admin_refresh" : "automatic_collection_due");
}

export function socialProfileSnapshotGuardResultFromRpc(value: Record<string, unknown>): SocialProfileSnapshotGuardResult {
  const classification = String(value.classification ?? "terminal_suppressed") as SocialProfileSnapshotGuardClassification;
  return {
    classification,
    reason: String(value.reason ?? "unknown"),
    jobId: String(value.job_id ?? "") || null,
    jobStatus: String(value.job_status ?? "") || null,
    created: value.created === true,
    providerCallsNewJobMax: Number(value.provider_calls_new_job_max ?? 0),
    existingRetryProviderCallsMax: Number(value.existing_retry_provider_calls_max ?? 0),
    retryDue: value.retry_due === true,
  };
}
