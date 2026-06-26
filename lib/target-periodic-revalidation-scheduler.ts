import { isTargetRowCanonicallyEligible } from "./instagram-dashboard/account-target-eligibility.ts";
import {
  buildPeriodicBatchId,
  buildPeriodicInitializationPatch,
  buildPeriodicVerificationJobPayload,
  buildPeriodicWindowKey,
  canClaimPeriodicWindow,
  emptyPeriodicRevalidationSchedulerSummary,
  hasActiveVerificationJob,
  isPeriodicRevalidationDue,
  needsPeriodicScheduleInitialization,
  PERIODIC_REVALIDATION_TRIGGER_SOURCE,
  type PeriodicRevalidationTargetRow,
  type PeriodicVerificationJobRow,
} from "./target-periodic-revalidation.ts";

export type PeriodicRevalidationSchedulerSummary = ReturnType<typeof emptyPeriodicRevalidationSchedulerSummary>;

export type PeriodicRevalidationSchedulerEnv = {
  enabled: boolean;
  dryRun: boolean;
  enqueueLimit: number;
};

type SchedulerQuery = {
  _filters: Array<{ op: string; column?: string; value?: unknown }>;
  select: (columns?: string) => SchedulerQuery;
  eq: (column: string, value: unknown) => SchedulerQuery;
  is: (column: string, value: unknown) => SchedulerQuery;
  or: (filters: string) => SchedulerQuery;
  in: (column: string, values: unknown[]) => SchedulerQuery;
  limit: (count: number) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
  update: (values: Record<string, unknown>) => SchedulerQuery;
  upsert: (
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) => Promise<{ error: { message?: string } | null }>;
  insert: (values: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
  maybeSingle: () => Promise<{ data: PeriodicRevalidationTargetRow | null; error: { message?: string } | null }>;
};

export type PeriodicRevalidationSchedulerSupabase = {
  from: (table: string) => SchedulerQuery;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readEnvBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function readEnvInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function readPeriodicRevalidationSchedulerEnv(
  env: NodeJS.ProcessEnv = process.env,
): PeriodicRevalidationSchedulerEnv {
  return {
    enabled: readEnvBoolean(env.CT_TARGET_PERIODIC_REVALIDATION_ENABLED, false),
    dryRun: readEnvBoolean(env.CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN, true),
    enqueueLimit: readEnvInteger(env.CT_TARGET_PERIODIC_REVALIDATION_ENQUEUE_LIMIT, 25, 1, 100),
  };
}

function normalizeUsername(row: PeriodicRevalidationTargetRow) {
  return readString(row.normalized_username, readString(row.target_username, "")).toLowerCase();
}

function isEligiblePeriodicTarget(row: PeriodicRevalidationTargetRow) {
  return isTargetRowCanonicallyEligible(row);
}

async function tryRecordPeriodicAudit(
  supabase: PeriodicRevalidationSchedulerSupabase,
  input: Record<string, unknown>,
) {
  try {
    await supabase.from("ct_target_audit_events").insert({
      ...input,
      metadata_safe: {
        trigger_source: PERIODIC_REVALIDATION_TRIGGER_SOURCE,
        ...(input.metadata_safe as Record<string, unknown> | undefined),
      },
    });
  } catch {
    // Best-effort observability only.
  }
}

export async function runPeriodicTargetRevalidationScheduler(
  supabase: PeriodicRevalidationSchedulerSupabase,
  input: {
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    enqueueLimit?: number;
    dryRun?: boolean;
  } = {},
) {
  const schedulerEnv = readPeriodicRevalidationSchedulerEnv(input.env);
  const now = input.now?.() ?? new Date();
  const nowIso = now.toISOString();
  const dryRun = input.dryRun ?? schedulerEnv.dryRun;
  const enqueueLimit = input.enqueueLimit ?? schedulerEnv.enqueueLimit;
  const summary = {
    ...emptyPeriodicRevalidationSchedulerSummary(),
    enabled: schedulerEnv.enabled,
    dry_run: dryRun,
  };

  if (!schedulerEnv.enabled) return summary;

  const windowKey = buildPeriodicWindowKey(now);
  const batchId = buildPeriodicBatchId(windowKey);

  const { data: candidateRows, error: candidateError } = await supabase
    .from("ig_targets")
    .select("id,account_id,normalized_username,target_username,status,quality_status,verification_status,archived_at,deleted_at,periodic_revalidation_next_due_at,periodic_revalidation_window_key")
    .or(`periodic_revalidation_next_due_at.is.null,periodic_revalidation_next_due_at.lte.${nowIso}`)
    .limit(Math.max(enqueueLimit * 4, enqueueLimit));

  if (candidateError) {
    summary.errors_count += 1;
    return summary;
  }

  const eligibleRows = (candidateRows as PeriodicRevalidationTargetRow[] | null ?? []).filter(isEligiblePeriodicTarget);
  summary.due_count = eligibleRows.filter((row) => isPeriodicRevalidationDue(row, now)).length;

  const targetIds = eligibleRows.map((row) => readString(row.id, "")).filter(Boolean);
  const jobsByTarget = new Map<string, PeriodicVerificationJobRow>();
  if (targetIds.length > 0) {
    const { data: jobs } = await supabase
      .from("ct_target_verification_jobs")
      .select("target_id,status,batch_id")
      .in("target_id", targetIds)
      .limit(5000);
    for (const job of (jobs as PeriodicVerificationJobRow[] | null) ?? []) {
      const targetId = readString(job.target_id, "");
      if (targetId) jobsByTarget.set(targetId, job);
    }
  }

  let enqueued = 0;
  for (const candidate of eligibleRows) {
    let row = candidate;
    if (enqueued >= enqueueLimit) break;
    const targetId = readString(row.id, "");
    const accountId = readString(row.account_id, "");
    const username = normalizeUsername(row);
    if (!targetId || !accountId || !username) continue;

    if (needsPeriodicScheduleInitialization(row)) {
      const initPatch = buildPeriodicInitializationPatch(targetId, now);
      let initializedDueAt = initPatch.periodic_revalidation_next_due_at;
      if (!dryRun) {
        const initResult = await supabase
          .from("ig_targets")
          .update(initPatch)
          .eq("id", targetId)
          .eq("account_id", accountId)
          .is("periodic_revalidation_next_due_at", null)
          .select("id,periodic_revalidation_next_due_at")
          .maybeSingle();
        if (!initResult.data) {
          const existing = await supabase
            .from("ig_targets")
            .select("periodic_revalidation_next_due_at")
            .eq("id", targetId)
            .eq("account_id", accountId)
            .maybeSingle();
          initializedDueAt = readString(existing.data?.periodic_revalidation_next_due_at, initializedDueAt);
        } else {
          initializedDueAt = readString(initResult.data.periodic_revalidation_next_due_at, initializedDueAt);
        }
      }
      summary.initialized_count += 1;
      if (!isPeriodicRevalidationDue({ ...row, periodic_revalidation_next_due_at: initializedDueAt }, now)) {
        summary.deferred_not_due_count += 1;
        continue;
      }
      row = { ...row, periodic_revalidation_next_due_at: initializedDueAt };
    } else if (!isPeriodicRevalidationDue(row, now)) {
      summary.deferred_not_due_count += 1;
      continue;
    }

    if (hasActiveVerificationJob(jobsByTarget.get(targetId))) {
      summary.skipped_active_job_count += 1;
      continue;
    }

    if (!canClaimPeriodicWindow(row, windowKey)) {
      summary.skipped_window_claim_count += 1;
      continue;
    }

    summary.selected_count += 1;
    if (dryRun) {
      enqueued += 1;
      summary.enqueued_count += 1;
      continue;
    }

    const claim = await supabase
      .from("ig_targets")
      .update({ periodic_revalidation_window_key: windowKey })
      .eq("id", targetId)
      .eq("account_id", accountId)
      .select("id")
      .maybeSingle();

    if (claim.error || !claim.data) {
      summary.skipped_window_claim_count += 1;
      continue;
    }

    const payload = buildPeriodicVerificationJobPayload({
      targetId,
      accountId,
      normalizedUsername: username,
      windowKey,
    });
    const { error: upsertError } = await supabase
      .from("ct_target_verification_jobs")
      .upsert(payload, { onConflict: "target_id", ignoreDuplicates: true });

    if (upsertError) {
      summary.errors_count += 1;
      await supabase
        .from("ig_targets")
        .update({ periodic_revalidation_window_key: null })
        .eq("id", targetId)
        .eq("account_id", accountId)
        .select("id")
        .maybeSingle();
      continue;
    }

    enqueued += 1;
    summary.enqueued_count += 1;
    await tryRecordPeriodicAudit(supabase, {
      account_id: accountId,
      target_id: targetId,
      operation: "target_periodic_revalidation_enqueue",
      result: "accepted",
      reason: "periodic_weekly_due",
      actor_type: "system",
      batch_id: batchId,
      counts: { enqueued: 1 },
      metadata_safe: { periodic_window_key: windowKey },
    });
  }

  return summary;
}
