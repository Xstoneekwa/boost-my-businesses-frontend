import { createSupabaseClient } from "@/lib/supabase";
import {
  buildTargetVerificationJobDecision,
  emptyVerificationBatchSummary,
  nextVerificationAttemptAt,
} from "@/lib/instagram-target-verification-jobs";
import {
  verifySingleTargetUsername,
  type BulkTargetSummary,
  type TargetActorType,
} from "@/lib/instagram-targets";
import {
  jsonError,
  jsonOk,
  readInteger,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  type SupabaseRecord,
} from "../../_utils";

export const dynamic = "force-dynamic";

type VerifyBatchBody = {
  limit?: number | string;
  locked_by?: string;
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

function safeWorkerId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) || "dashboard_verify_batch";
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
  supabase: ReturnType<typeof createSupabaseClient>,
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
    // CT verification audit is best-effort; API responses carry safe summary counts.
  }
}

async function isTargetStillVerifiable(
  supabase: ReturnType<typeof createSupabaseClient>,
  job: ClaimedJob,
) {
  const { data, error } = await supabase
    .from("ig_targets")
    .select("id, status, archived_at, deleted_at")
    .eq("id", job.target_id)
    .eq("account_id", job.account_id)
    .maybeSingle();

  if (error || !data) return false;

  const row = data as SupabaseRecord;
  const status = readString(row.status, "").toLowerCase();
  return status !== "archived" && status !== "deleted" && !readString(row.archived_at, "") && !readString(row.deleted_at, "");
}

async function markJobSkipped(
  supabase: ReturnType<typeof createSupabaseClient>,
  job: ClaimedJob,
) {
  const now = new Date().toISOString();
  await supabase
    .from("ct_target_verification_jobs")
    .update({
      status: "skipped",
      locked_at: null,
      locked_by: null,
      last_error_code: "target_not_verifiable",
      last_error_message: "Target is archived, deleted, or unavailable.",
      updated_at: now,
    })
    .eq("id", job.id);
}

async function markProcessorError(
  supabase: ReturnType<typeof createSupabaseClient>,
  job: ClaimedJob,
  error: unknown,
) {
  const now = new Date();
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

export async function POST(request: Request) {
  try {
    const unauthorized = await requireInstagramAdmin();
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<VerifyBatchBody>(request);
    const requestedLimit = readInteger(body?.limit, 5);
    const limit = Math.min(Math.max(requestedLimit, 1), 10);
    const lockedBy = safeWorkerId(readString(body?.locked_by, "dashboard_verify_batch"));
    const supabase = createSupabaseClient();

    const { data: claimedRows, error: claimError } = await supabase.rpc("claim_ct_target_verification_jobs", {
      batch_limit: limit,
      worker_id: lockedBy,
    });

    if (claimError) return jsonError(claimError.message, 500);

    const jobs = ((claimedRows ?? []) as SupabaseRecord[]).map(safeJob).filter((job): job is ClaimedJob => Boolean(job));
    const summary = emptyVerificationBatchSummary();

    for (const job of jobs) {
      summary.jobs_processed += 1;

      try {
        const verifiable = await isTargetStillVerifiable(supabase, job);
        if (!verifiable) {
          await markJobSkipped(supabase, job);
          summary.skipped += 1;
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

        const decision = await verifySingleTargetUsername(job.normalized_username);
        const jobDecision = buildTargetVerificationJobDecision({
          decision,
          attemptCount: job.attempt_count,
          maxAttempts: job.max_attempts,
          now: new Date(),
        });
        const now = new Date().toISOString();

        const { error: targetError } = await supabase
          .from("ig_targets")
          .update({
            ...jobDecision.targetPatch,
            updated_at: now,
          })
          .eq("id", job.target_id)
          .eq("account_id", job.account_id);

        if (targetError) throw new Error(targetError.message);

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
            updated_at: now,
          })
          .eq("id", job.id);

        if (jobError) throw new Error(jobError.message);

        if (decision.verification_status === "rate_limited") summary.rate_limited += 1;
        if (decision.verification_status === "provider_error" || decision.verification_status === "unavailable") {
          summary.provider_error += 1;
        }
        if (jobDecision.jobStatus === "retry_scheduled") summary.retry_scheduled += 1;
        else if (jobDecision.targetPatch.status === "valid") summary.succeeded += 1;
        else if (jobDecision.targetPatch.status === "rejected") summary.rejected += 1;
        else if (jobDecision.targetPatch.status === "review") summary.review += 1;

        await tryRecordTargetAudit(supabase, {
          accountId: job.account_id,
          targetId: job.target_id,
          batchId: job.batch_id,
          result: jobDecision.auditResult,
          reason: jobDecision.auditReason,
          actorType: "system",
        });
      } catch (error) {
        await markProcessorError(supabase, job, error);
        summary.retry_scheduled += job.attempt_count < job.max_attempts ? 1 : 0;
        summary.provider_error += 1;
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

    return jsonOk({
      limit,
      locked_by: lockedBy,
      summary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify target batch.";
    return jsonError(message, 500);
  }
}
