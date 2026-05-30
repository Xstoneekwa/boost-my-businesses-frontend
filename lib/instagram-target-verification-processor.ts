import {
  buildTargetVerificationJobDecision,
  nextVerificationAttemptAt,
} from "./instagram-target-verification-jobs.ts";
import {
  verifySingleTargetUsername,
  type BulkTargetSummary,
  type TargetActorType,
  type TargetVerificationDecision,
} from "./instagram-targets.ts";

export type SupabaseRecord = Record<string, unknown>;

export type TargetVerificationBatchSummary = {
  claimed_count: number;
  processed_count: number;
  succeeded_count: number;
  rejected_count: number;
  review_count: number;
  retry_scheduled_count: number;
  skipped_count: number;
  rate_limited_count: number;
  provider_error_count: number;
  duration_ms: number;
};

export type TargetVerificationProcessorResult = {
  limit: number;
  dry_run: boolean;
  worker_id: string;
  max_duration_ms: number;
  stopped_early_reason: string | null;
  summary: TargetVerificationBatchSummary;
};

export type TargetVerificationProcessorOptions = {
  limit?: number | string;
  dryRun?: boolean;
  workerId?: string;
  maxDurationMs?: number | string;
  now?: () => Date;
  verifyUsername?: (username: string) => Promise<TargetVerificationDecision>;
};

type ClaimedJob = {
  id: string;
  target_id: string;
  account_id: string;
  batch_id: string | null;
  normalized_username: string;
  attempt_count: number;
  max_attempts: number;
};

type SupabaseError = { message?: string } | null;
type SupabaseResult<T> = Promise<{ data: T | null; error: SupabaseError }>;
type SupabaseMutationResult = { data: SupabaseRecord[] | null; error: SupabaseError };
type SupabaseQuery = {
  select: (columns: string) => SupabaseQuery;
  eq: (column: string, value: unknown) => SupabaseQuery;
  in: (column: string, values: unknown[]) => SupabaseQuery;
  or: (filters: string) => SupabaseQuery;
  order: (column: string, options?: Record<string, unknown>) => SupabaseQuery;
  limit: (count: number) => SupabaseResult<SupabaseRecord[]>;
  maybeSingle: () => SupabaseResult<SupabaseRecord | null>;
  update: (values: SupabaseRecord) => SupabaseQuery;
  insert: (values: SupabaseRecord) => SupabaseResult<SupabaseRecord[]>;
  then: Promise<SupabaseMutationResult>["then"];
};

export type TargetVerificationSupabaseClient = {
  rpc: (name: string, args: Record<string, unknown>) => SupabaseResult<SupabaseRecord[]>;
  from: (table: string) => SupabaseQuery;
};

export function safeTargetVerificationWorkerId(value: string | null | undefined) {
  return (value || "dashboard_verify_batch").trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) || "dashboard_verify_batch";
}

export function boundedTargetVerificationLimit(value: number | string | null | undefined) {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 5;
  const parsed = Number.isFinite(raw) ? Math.trunc(raw) : 5;
  return Math.min(Math.max(parsed, 1), 10);
}

export function boundedTargetVerificationMaxDurationMs(value: number | string | null | undefined) {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 10_000;
  const parsed = Number.isFinite(raw) ? Math.trunc(raw) : 10_000;
  return Math.min(Math.max(parsed, 1_000), 25_000);
}

export function emptyTargetVerificationBatchSummary(): TargetVerificationBatchSummary {
  return {
    claimed_count: 0,
    processed_count: 0,
    succeeded_count: 0,
    rejected_count: 0,
    review_count: 0,
    retry_scheduled_count: 0,
    skipped_count: 0,
    rate_limited_count: 0,
    provider_error_count: 0,
    duration_ms: 0,
  };
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readInteger(value: unknown, fallback = 0) {
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  return Number.isFinite(raw) ? Math.trunc(raw) : fallback;
}

function safeMessage(value: unknown) {
  if (typeof value !== "string") return "processor_error";
  return value.trim().replace(/[\r\n\t]/g, " ").slice(0, 240) || "processor_error";
}

function safeJob(row: SupabaseRecord): ClaimedJob | null {
  const id = readString(row.id, "");
  const targetId = readString(row.target_id, "");
  const accountId = readString(row.account_id, "");
  const normalizedUsername = readString(row.normalized_username, "");

  if (!id || !targetId || !accountId || !normalizedUsername) return null;

  return {
    id,
    target_id: targetId,
    account_id: accountId,
    batch_id: readString(row.batch_id, "") || null,
    normalized_username: normalizedUsername,
    attempt_count: Math.max(1, readInteger(row.attempt_count, 1)),
    max_attempts: Math.max(1, readInteger(row.max_attempts, 3)),
  };
}

async function tryRecordTargetAudit(
  supabase: TargetVerificationSupabaseClient,
  input: {
    accountId: string;
    result: "accepted" | "rejected" | "review" | "failed";
    reason: string;
    actorType: TargetActorType;
    batchId?: string | null;
    targetId?: string | null;
    counts?: BulkTargetSummary | Record<string, number>;
  },
) {
  try {
    await supabase.from("ct_target_audit_events").insert({
      account_id: input.accountId,
      target_id: input.targetId ?? null,
      operation: "target_verify",
      result: input.result,
      reason: input.reason,
      actor_type: input.actorType,
      batch_id: input.batchId ?? null,
      counts: input.counts ?? null,
      metadata_safe: { source: "target_verify_batch", reason: input.reason },
    });
  } catch {
    // CT verification audit is best-effort; processor responses carry safe summary counts.
  }
}

async function isTargetStillVerifiable(
  supabase: TargetVerificationSupabaseClient,
  job: ClaimedJob,
) {
  const { data, error } = await supabase
    .from("ig_targets")
    .select("id, status, archived_at, deleted_at")
    .eq("id", job.target_id)
    .eq("account_id", job.account_id)
    .maybeSingle();

  if (error || !data) return false;

  const status = readString(data.status, "").toLowerCase();
  return status !== "archived" && status !== "deleted" && !readString(data.archived_at, "") && !readString(data.deleted_at, "");
}

async function markJobSkipped(
  supabase: TargetVerificationSupabaseClient,
  job: ClaimedJob,
  nowIso: string,
) {
  await supabase
    .from("ct_target_verification_jobs")
    .update({
      status: "skipped",
      locked_at: null,
      locked_by: null,
      last_error_code: "target_not_verifiable",
      last_error_message: "Target is archived, deleted, or unavailable.",
      updated_at: nowIso,
    })
    .eq("id", job.id);
}

async function markProcessorError(
  supabase: TargetVerificationSupabaseClient,
  job: ClaimedJob,
  error: unknown,
  now: Date,
) {
  const canRetry = job.attempt_count < job.max_attempts;
  await supabase
    .from("ct_target_verification_jobs")
    .update({
      status: canRetry ? "retry_scheduled" : "failed",
      next_attempt_at: canRetry ? nextVerificationAttemptAt(now, job.attempt_count) : null,
      locked_at: null,
      locked_by: null,
      last_error_code: "processor_error",
      last_error_message: safeMessage(error instanceof Error ? error.message : "processor_error"),
      provider_status: "provider_error",
      updated_at: now.toISOString(),
    })
    .eq("id", job.id);
}

async function requeueUnprocessedJobs(
  supabase: TargetVerificationSupabaseClient,
  jobs: ClaimedJob[],
  now: Date,
  reason: "batch_stopped_after_rate_limit" | "batch_max_duration_reached",
  providerStatus: "rate_limited" | null,
) {
  for (const job of jobs) {
    await supabase
      .from("ct_target_verification_jobs")
      .update({
        status: "retry_scheduled",
        next_attempt_at: nextVerificationAttemptAt(now, job.attempt_count),
        locked_at: null,
        locked_by: null,
        last_error_code: reason,
        last_error_message: reason,
        provider_status: providerStatus,
        updated_at: now.toISOString(),
      })
      .eq("id", job.id);
  }
}

async function previewClaimableJobs(
  supabase: TargetVerificationSupabaseClient,
  limit: number,
  now: Date,
) {
  const { data, error } = await supabase
    .from("ct_target_verification_jobs")
    .select("id, target_id, account_id, batch_id, normalized_username, attempt_count, max_attempts")
    .in("status", ["pending", "retry_scheduled"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message || "target_verification_dry_run_failed");
  return ((data ?? []) as SupabaseRecord[]).map(safeJob).filter((job): job is ClaimedJob => Boolean(job));
}

async function claimJobs(
  supabase: TargetVerificationSupabaseClient,
  limit: number,
  workerId: string,
) {
  const { data, error } = await supabase.rpc("claim_ct_target_verification_jobs", {
    batch_limit: limit,
    worker_id: workerId,
  });

  if (error) throw new Error(error.message || "target_verification_claim_failed");
  return ((data ?? []) as SupabaseRecord[]).map(safeJob).filter((job): job is ClaimedJob => Boolean(job));
}

export async function processTargetVerificationBatch(
  supabase: TargetVerificationSupabaseClient,
  options: TargetVerificationProcessorOptions = {},
): Promise<TargetVerificationProcessorResult> {
  const startedAtMs = Date.now();
  const now = options.now ?? (() => new Date());
  const limit = boundedTargetVerificationLimit(options.limit);
  const dryRun = options.dryRun === true;
  const workerId = safeTargetVerificationWorkerId(options.workerId);
  const maxDurationMs = boundedTargetVerificationMaxDurationMs(options.maxDurationMs);
  const verifyUsername = options.verifyUsername ?? verifySingleTargetUsername;
  const summary = emptyTargetVerificationBatchSummary();
  let stoppedEarlyReason: string | null = null;

  const jobs = dryRun
    ? await previewClaimableJobs(supabase, limit, now())
    : await claimJobs(supabase, limit, workerId);
  summary.claimed_count = jobs.length;

  if (dryRun) {
    summary.duration_ms = Date.now() - startedAtMs;
    return {
      limit,
      dry_run: true,
      worker_id: workerId,
      max_duration_ms: maxDurationMs,
      stopped_early_reason: null,
      summary,
    };
  }

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const elapsedMs = Date.now() - startedAtMs;
    if (elapsedMs >= maxDurationMs) {
      stoppedEarlyReason = "batch_max_duration_reached";
      const remaining = jobs.slice(index);
      await requeueUnprocessedJobs(supabase, remaining, now(), "batch_max_duration_reached", null);
      summary.retry_scheduled_count += remaining.length;
      break;
    }

    summary.processed_count += 1;

    try {
      const currentNow = now();
      const verifiable = await isTargetStillVerifiable(supabase, job);
      if (!verifiable) {
        await markJobSkipped(supabase, job, currentNow.toISOString());
        summary.skipped_count += 1;
        await tryRecordTargetAudit(supabase, {
          accountId: job.account_id,
          targetId: job.target_id,
          batchId: job.batch_id,
          result: "failed",
          reason: "target_not_verifiable",
          actorType: "system",
        });
        continue;
      }

      const decision = await verifyUsername(job.normalized_username);
      const jobDecision = buildTargetVerificationJobDecision({
        decision,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts,
        now: currentNow,
      });
      const nowIso = currentNow.toISOString();

      const { error: targetError } = await supabase
        .from("ig_targets")
        .update({
          ...jobDecision.targetPatch,
          updated_at: nowIso,
        })
        .eq("id", job.target_id)
        .eq("account_id", job.account_id);

      if (targetError) throw new Error(targetError.message || "target_update_failed");

      const { error: jobError } = await supabase
        .from("ct_target_verification_jobs")
        .update({
          status: jobDecision.jobStatus,
          next_attempt_at: jobDecision.nextAttemptAt,
          locked_at: null,
          locked_by: null,
          last_error_code: jobDecision.lastErrorCode,
          last_error_message: jobDecision.lastErrorMessage,
          provider_status: decision.verification_status,
          updated_at: nowIso,
        })
        .eq("id", job.id);

      if (jobError) throw new Error(jobError.message || "job_update_failed");

      if (decision.verification_status === "rate_limited") summary.rate_limited_count += 1;
      if (decision.verification_status === "provider_error" || decision.verification_status === "unavailable") {
        summary.provider_error_count += 1;
      }
      if (jobDecision.jobStatus === "retry_scheduled") summary.retry_scheduled_count += 1;
      else if (jobDecision.targetPatch.status === "valid") summary.succeeded_count += 1;
      else if (jobDecision.targetPatch.status === "rejected") summary.rejected_count += 1;
      else if (jobDecision.targetPatch.status === "review") summary.review_count += 1;

      await tryRecordTargetAudit(supabase, {
        accountId: job.account_id,
        targetId: job.target_id,
        batchId: job.batch_id,
        result: jobDecision.auditResult,
        reason: jobDecision.auditReason,
        actorType: "system",
      });

      if (decision.verification_status === "rate_limited") {
        stoppedEarlyReason = "rate_limited";
        const remaining = jobs.slice(index + 1);
        await requeueUnprocessedJobs(supabase, remaining, currentNow, "batch_stopped_after_rate_limit", "rate_limited");
        summary.retry_scheduled_count += remaining.length;
        break;
      }
    } catch (error) {
      const currentNow = now();
      await markProcessorError(supabase, job, error, currentNow);
      summary.retry_scheduled_count += job.attempt_count < job.max_attempts ? 1 : 0;
      summary.provider_error_count += 1;
      await tryRecordTargetAudit(supabase, {
        accountId: job.account_id,
        targetId: job.target_id,
        batchId: job.batch_id,
        result: "failed",
        reason: "processor_error",
        actorType: "system",
      });
    }
  }

  summary.duration_ms = Date.now() - startedAtMs;
  return {
    limit,
    dry_run: false,
    worker_id: workerId,
    max_duration_ms: maxDurationMs,
    stopped_early_reason: stoppedEarlyReason,
    summary,
  };
}
