export const PERIODIC_REVALIDATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const PERIODIC_REVALIDATION_BATCH_PREFIX = "periodic_weekly";
export const PERIODIC_REVALIDATION_TRIGGER_SOURCE = "periodic_weekly";

export type PeriodicRevalidationTargetRow = {
  id?: string | null;
  account_id?: string | null;
  normalized_username?: string | null;
  target_username?: string | null;
  status?: string | null;
  quality_status?: string | null;
  verification_status?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  periodic_revalidation_last_terminal_at?: string | null;
  periodic_revalidation_next_due_at?: string | null;
  periodic_revalidation_window_key?: string | null;
};

export type PeriodicVerificationJobRow = {
  target_id?: string | null;
  status?: string | null;
  batch_id?: string | null;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function isPeriodicRevalidationBatchId(batchId: string | null | undefined) {
  return readString(batchId, "").startsWith(`${PERIODIC_REVALIDATION_BATCH_PREFIX}:`);
}

export function computePeriodicStaggerOffsetMs(targetId: string) {
  let hash = 2166136261;
  for (let index = 0; index < targetId.length; index += 1) {
    hash ^= targetId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % PERIODIC_REVALIDATION_INTERVAL_MS;
}

/** ISO week anchor: Monday 00:00:00.000 UTC for the week containing referenceUtc. */
export function computePeriodicStaggerAnchorUtc(referenceUtc: Date) {
  const anchor = new Date(Date.UTC(
    referenceUtc.getUTCFullYear(),
    referenceUtc.getUTCMonth(),
    referenceUtc.getUTCDate(),
    0,
    0,
    0,
    0,
  ));
  const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - daysSinceMonday);
  return anchor;
}

export function computeInitialPeriodicNextDueAt(targetId: string, referenceUtc: Date) {
  const anchorUtc = computePeriodicStaggerAnchorUtc(referenceUtc);
  return new Date(anchorUtc.getTime() + computePeriodicStaggerOffsetMs(targetId));
}

export function computeNextPeriodicDueAfterTerminal(terminalAtUtc: Date) {
  return new Date(terminalAtUtc.getTime() + PERIODIC_REVALIDATION_INTERVAL_MS);
}

export function buildPeriodicWindowKey(nowUtc: Date) {
  const hourBucket = Math.floor(nowUtc.getTime() / (60 * 60 * 1000));
  return `${hourBucket}`;
}

export function buildPeriodicBatchId(windowKey: string) {
  return `${PERIODIC_REVALIDATION_BATCH_PREFIX}:${windowKey}`;
}

export function clearPeriodicSchedulePatch() {
  return {
    periodic_revalidation_last_terminal_at: null,
    periodic_revalidation_next_due_at: null,
    periodic_revalidation_window_key: null,
  };
}

export function buildRestorePeriodicSchedulePatch(targetId: string, nowUtc: Date) {
  return {
    periodic_revalidation_last_terminal_at: null,
    periodic_revalidation_next_due_at: computeInitialPeriodicNextDueAt(targetId, nowUtc).toISOString(),
    periodic_revalidation_window_key: null,
  };
}

export function buildPeriodicSchedulePatchAfterTerminal(
  terminalAtUtc: Date,
  hygieneAction:
    | "none"
    | "rename_confirmed"
    | "archive_not_found"
    | "archive_verified"
    | "apply_quality_decision",
) {
  if (hygieneAction === "rename_confirmed") {
    return { periodic_revalidation_window_key: null };
  }
  if (hygieneAction === "archive_not_found" || hygieneAction === "archive_verified") {
    return clearPeriodicSchedulePatch();
  }
  if (hygieneAction === "none") {
    return { periodic_revalidation_window_key: null };
  }
  return {
    periodic_revalidation_last_terminal_at: terminalAtUtc.toISOString(),
    periodic_revalidation_next_due_at: computeNextPeriodicDueAfterTerminal(terminalAtUtc).toISOString(),
    periodic_revalidation_window_key: null,
  };
}

export function shouldAdvancePeriodicSchedule(input: {
  batchId: string | null | undefined;
  jobStatus: string;
  hygieneAction:
    | "none"
    | "rename_confirmed"
    | "archive_not_found"
    | "archive_verified"
    | "apply_quality_decision";
}) {
  if (!isPeriodicRevalidationBatchId(input.batchId)) return false;
  if (input.jobStatus === "retry_scheduled") return false;
  return input.hygieneAction !== "none";
}

export function isPeriodicRevalidationDue(row: PeriodicRevalidationTargetRow, nowUtc: Date) {
  const nextDueRaw = readString(row.periodic_revalidation_next_due_at, "");
  if (!nextDueRaw) return false;
  const nextDueMs = Date.parse(nextDueRaw);
  if (Number.isNaN(nextDueMs)) return false;
  return nextDueMs <= nowUtc.getTime();
}

export function isWithinOneHourOfPeriodicDue(row: PeriodicRevalidationTargetRow, nowUtc: Date) {
  const nextDueRaw = readString(row.periodic_revalidation_next_due_at, "");
  if (!nextDueRaw) return false;
  const nextDueMs = Date.parse(nextDueRaw);
  if (Number.isNaN(nextDueMs)) return false;
  return nextDueMs - nowUtc.getTime() > 0 && nextDueMs - nowUtc.getTime() <= 60 * 60 * 1000;
}

export function needsPeriodicScheduleInitialization(row: PeriodicRevalidationTargetRow) {
  return !readString(row.periodic_revalidation_next_due_at, "");
}

export function buildPeriodicInitializationPatch(targetId: string, nowUtc: Date) {
  return {
    periodic_revalidation_next_due_at: computeInitialPeriodicNextDueAt(targetId, nowUtc).toISOString(),
    periodic_revalidation_window_key: null,
  };
}

export function hasActiveVerificationJob(job: PeriodicVerificationJobRow | null | undefined) {
  if (!job) return false;
  const status = readString(job.status, "").toLowerCase();
  return status === "pending" || status === "processing" || status === "retry_scheduled";
}

export function canClaimPeriodicWindow(
  row: PeriodicRevalidationTargetRow,
  windowKey: string,
) {
  const current = readString(row.periodic_revalidation_window_key, "");
  return !current || current === windowKey;
}

export function buildPeriodicVerificationJobPayload(input: {
  targetId: string;
  accountId: string;
  normalizedUsername: string;
  windowKey: string;
}) {
  return {
    target_id: input.targetId,
    account_id: input.accountId,
    batch_id: buildPeriodicBatchId(input.windowKey),
    normalized_username: input.normalizedUsername,
    status: "pending",
    attempt_count: 0,
    max_attempts: 3,
    next_attempt_at: null,
    locked_at: null,
    locked_by: null,
    last_error_code: null,
    last_error_message: null,
    provider_status: "pending",
    metadata_safe: {
      trigger_source: PERIODIC_REVALIDATION_TRIGGER_SOURCE,
      periodic_window_key: input.windowKey,
    },
  };
}

export function emptyPeriodicRevalidationSchedulerSummary() {
  return {
    enabled: false,
    dry_run: true,
    due_count: 0,
    initialized_count: 0,
    selected_count: 0,
    enqueued_count: 0,
    skipped_active_job_count: 0,
    skipped_window_claim_count: 0,
    deferred_not_due_count: 0,
    provider_deferred_count: 0,
    errors_count: 0,
  };
}
