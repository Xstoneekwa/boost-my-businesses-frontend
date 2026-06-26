import { projectPersistedTargetAvatar } from "@/lib/instagram-dashboard/target-avatar-projection";
import { enrichBulkTargetLinesWithProvider } from "@/lib/instagram-dashboard/target-provider-enrichment";
import { createSupabaseClient } from "@/lib/supabase";
import {
  buildTargetVerificationJobDecision,
  buildTargetVerificationJobPayloads,
} from "@/lib/instagram-target-verification-jobs";
import {
  CT_MANUAL_FOLLOWERS_MAX_GUARD,
  CT_QUALITY_MIN_FOLLOWERS,
} from "@/lib/instagram-target-quality";
import {
  buildRestoreLifecycleDecision,
  hasActiveDuplicateForRestore,
  isArchivedTargetLifecycle,
  isDeletedTargetLifecycle,
} from "@/lib/instagram-target-lifecycle";
import {
  buildRestorePeriodicSchedulePatch,
  clearPeriodicSchedulePatch,
} from "@/lib/target-periodic-revalidation";
import {
  classifyBulkTargetLines,
  isValidTargetUsername,
  normalizeTargetUsername,
  pendingTargetVerificationDecision,
  summarizeBulkTargetLines,
  verifySingleTargetUsername,
  type BulkTargetSummary,
  type TargetActorType,
  type TargetSource,
  type TargetVerificationDecision,
} from "@/lib/instagram-targets";
import type { TargetSafeRow } from "@/app/instagram-dashboard/targets-data";
import {
  readFollowbacksMetricsReliableAt,
  resolveTargetFbrMetrics,
} from "./target-fbr-metrics.ts";
import {
  evaluateTargetReaddBlock,
  shouldAllowAutoArchiveRestoreOverride,
  TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON,
  TARGET_AUTO_ARCHIVE_READD_BLOCKED_AUDIT_REASON,
} from "@/lib/instagram-dashboard/target-auto-archive-low-fbr-policy";
import { reevaluateNeedsMoreTargetAccountsAfterTargetMutation } from "@/lib/instagram-dashboard/needs-more-target-accounts";

export type { TargetSafeRow };

type SupabaseRecord = Record<string, unknown>;

export type TargetsServiceContext = {
  actorType: TargetActorType;
  sourceSurface: "admin_dashboard" | "client_dashboard" | "client_dashboard_ai";
};

export type TargetsServiceResult<T> =
  | { ok: true; data: T; status?: number }
  | { ok: false; error: string; status: number };

const defaultInlineBulkVerificationLimit = 5;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function readDateString(row: SupabaseRecord, key: string) {
  return readString(row[key], "") || null;
}

function readBooleanNullable(value: unknown) {
  if (typeof value === "boolean") return value;
  return null;
}

function performanceStatusFromTargetMetrics(
  qualityStatus: string,
  fbrPercent: number | null,
  followsSent: number | null,
): TargetSafeRow["performance_status"] {
  if (qualityStatus !== "eligible") return "not_applicable";
  if (followsSent === null || followsSent <= 0) return "pending";
  if (followsSent < 100) return "insufficient_data";
  if (fbrPercent === null) return "pending";
  if (fbrPercent <= 8) return "bad";
  if (fbrPercent < 15) return "avg";
  return "good";
}

export function safeTargetRow(row: SupabaseRecord): TargetSafeRow {
  const createdAt = readString(row.created_at, "");
  const followersCount = readNumber(row.followers_count ?? row.followers, Number.NaN);
  const followsSentCount = readNumber(row.follows_sent_count, Number.NaN);
  const followbacksCount = readNumber(row.followbacks_count, Number.NaN);
  const followbacksMetricsReliableAt = readFollowbacksMetricsReliableAt(row);
  const storedFollowbackRatio = readNumber(row.followback_ratio ?? row.fbr_percent, Number.NaN);
  const fbrMetrics = resolveTargetFbrMetrics({
    follows_sent_count: Number.isFinite(followsSentCount) ? followsSentCount : 0,
    followbacks_count: Number.isFinite(followbacksCount) ? followbacksCount : 0,
    followback_ratio: Number.isFinite(storedFollowbackRatio) ? storedFollowbackRatio : null,
    followbacks_metrics_reliable_at: followbacksMetricsReliableAt,
  });
  const id = readString(row.id ?? row.target_id, "");
  const targetUsername = normalizeTargetUsername(
    readString(row.normalized_username, readString(row.target_username, readString(row.input_username, ""))),
  );
  const qualityStatus = readString(row.quality_status, "unknown");
  const safeFbr = fbrMetrics.fbrPercent;
  const safeFollowsSent = Number.isFinite(followsSentCount) ? followsSentCount : null;
  const safeFollowbacks = Number.isFinite(followbacksCount) ? followbacksCount : null;
  const performanceStatus = performanceStatusFromTargetMetrics(qualityStatus, safeFbr, safeFollowsSent);
  const lastSelectedAt = readDateString(row, "last_selected_at");
  const lastUsedAt = readDateString(row, "last_used_at");
  const lastSuccessfulCandidateAt = readDateString(row, "last_successful_candidate_at");
  const lastExhaustedAt = readDateString(row, "last_exhausted_at");
  const exhaustionReason = readString(row.exhaustion_reason, "") || null;
  const cooldownUntil = readDateString(row, "cooldown_until");
  const metricsUpdatedAt = readDateString(row, "metrics_updated_at");
  const avatarProjection = projectPersistedTargetAvatar(readString(row.avatar_url, ""));

  return {
    target_id: id,
    id,
    account_id: readString(row.account_id, ""),
    input_username: readString(row.input_username, "") || null,
    normalized_username: readString(row.normalized_username, targetUsername) || null,
    canonical_username: readString(row.canonical_username, "") || null,
    target_username: targetUsername,
    status: readString(row.status, "unknown"),
    verification_status: readString(row.verification_status, "pending"),
    verification_reason: readString(row.verification_reason, "") || null,
    quality_status: qualityStatus,
    avatar_url: avatarProjection.avatarUrl,
    avatarAvailable: avatarProjection.avatarAvailable,
    avatarSource: avatarProjection.avatarSource,
    source: readString(row.source, "unknown"),
    actor_type: readString(row.actor_type, "") || null,
    rejected_reason: readString(row.rejected_reason, "") || null,
    batch_id: readString(row.batch_id, "") || null,
    provider_checked_at: readDateString(row, "provider_checked_at"),
    created_at: createdAt,
    updated_at: readString(row.updated_at, createdAt),
    followers_count: Number.isFinite(followersCount) ? followersCount : null,
    is_verified: readBooleanNullable(row.is_verified),
    is_private: readBooleanNullable(row.is_private),
    followback_ratio: safeFbr,
    follows_sent_count: safeFollowsSent,
    followbacks_count: safeFollowbacks,
    followbacks_metrics_reliable_at: followbacksMetricsReliableAt,
    fbrMetricsReliable: fbrMetrics.metricsReliable,
    performance_status: performanceStatus,
    followsSent: safeFollowsSent,
    followbacks: safeFollowbacks,
    fbrPercent: safeFbr,
    performanceStatus,
    last_selected_at: lastSelectedAt,
    last_used_at: lastUsedAt,
    last_successful_candidate_at: lastSuccessfulCandidateAt,
    last_exhausted_at: lastExhaustedAt,
    exhaustion_reason: exhaustionReason,
    cooldown_until: cooldownUntil,
    metrics_updated_at: metricsUpdatedAt,
    lastSelectedAt,
    lastUsedAt,
    lastSuccessfulCandidateAt,
    lastExhaustedAt,
    exhaustionReason,
    cooldownUntil,
    metricsUpdatedAt,
    added_at: readDateString(row, "added_at"),
    deleted_at: readDateString(row, "deleted_at"),
    archived_at: readDateString(row, "archived_at"),
  };
}

export function safeAdminTargetRow(row: SupabaseRecord): TargetSafeRow {
  return {
    ...safeTargetRow(row),
    archive_reason: readString(row.archive_reason, "") || null,
    auto_archived_at: readDateString(row, "auto_archived_at"),
    readd_blocked_permanently: typeof row.readd_blocked_permanently === "boolean"
      ? row.readd_blocked_permanently
      : null,
    readd_block_reason: readString(row.readd_block_reason, "") || null,
  };
}

function isDeletedTarget(row: SupabaseRecord) {
  const status = readString(row.status, "").toLowerCase();
  return status === "deleted" || Boolean(readString(row.deleted_at, ""));
}

function isArchivedTarget(row: SupabaseRecord) {
  const status = readString(row.status, "").toLowerCase();
  return status === "archived" || Boolean(readString(row.archived_at, ""));
}

function validateKnownFollowersCount(followersCount: number | null) {
  if (followersCount === null) return null;
  if (followersCount < CT_QUALITY_MIN_FOLLOWERS) {
    return `This target account cannot be added because it has fewer than ${CT_QUALITY_MIN_FOLLOWERS} followers.`;
  }
  if (followersCount > CT_MANUAL_FOLLOWERS_MAX_GUARD) {
    return `This target account cannot be added because it has more than ${new Intl.NumberFormat("en").format(CT_MANUAL_FOLLOWERS_MAX_GUARD)} followers.`;
  }
  return null;
}

function activeExistingUsername(row: SupabaseRecord) {
  if (isDeletedTarget(row) || isArchivedTarget(row)) return "";
  return normalizeTargetUsername(readString(row.normalized_username, readString(row.target_username, "")));
}

async function rejectBlockedTargetReadd(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  rows: SupabaseRecord[],
  targetUsername: string,
  ctx: TargetsServiceContext,
  operation: "target_add_single" | "target_add_bulk",
) {
  const block = evaluateTargetReaddBlock(rows, targetUsername);
  if (!block.blocked) return null;
  await tryRecordTargetAudit(supabase, {
    accountId,
    operation,
    result: "rejected",
    reason: TARGET_AUTO_ARCHIVE_READD_BLOCKED_AUDIT_REASON,
    actorType: ctx.actorType,
    sourceSurface: ctx.sourceSurface,
  });
  const message = ctx.actorType === "client"
    ? (block.clientMessageFr ?? "Ce compte cible a été mis de côté pour cette campagne.")
    : (block.clientMessageEn ?? "This target account has been set aside for this campaign.");
  return { ok: false as const, error: message, status: 409 as const };
}

function targetSourceForAdd(mode: "single" | "bulk", ctx: TargetsServiceContext): TargetSource {
  if (ctx.sourceSurface === "client_dashboard_ai") return "future_discovery";
  if (ctx.actorType === "client") return "client";
  return mode === "bulk" ? "manual_bulk" : "manual_single";
}

function targetInsertPayload(input: {
  accountId: string;
  inputUsername: string;
  normalizedUsername: string;
  source: TargetSource;
  actorType: TargetActorType;
  now: string;
  batchId?: string | null;
  decision: TargetVerificationDecision;
}) {
  return {
    account_id: input.accountId,
    target_username: input.normalizedUsername,
    input_username: input.inputUsername,
    normalized_username: input.normalizedUsername,
    canonical_username: input.decision.canonical_username,
    status: input.decision.status,
    verification_status: input.decision.verification_status,
    verification_reason: input.decision.verification_reason,
    quality_status: input.decision.quality_status,
    avatar_url: input.decision.avatar_url,
    followers_count: input.decision.followers_count,
    is_verified: input.decision.is_verified,
    is_private: input.decision.is_private,
    provider_checked_at: input.decision.provider_checked_at,
    batch_id: input.batchId ?? null,
    source: input.source,
    actor_type: input.actorType,
    rejected_reason: input.decision.rejected_reason,
    metadata_safe: input.decision.metadata_safe,
    created_at: input.now,
    updated_at: input.now,
  };
}

async function tryRecordTargetAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    operation: "target_add_single" | "target_add_bulk" | "target_verify" | "target_archive" | "target_restore";
    result: "accepted" | "duplicate" | "rejected" | "review" | "failed" | "archived" | "restored";
    reason: string;
    actorType: TargetActorType;
    sourceSurface?: TargetsServiceContext["sourceSurface"];
    batchId?: string | null;
    targetId?: string | null;
    counts?: BulkTargetSummary;
    previousStatus?: string | null;
    nextStatus?: string | null;
  },
) {
  try {
    await supabase.from("ct_target_audit_events").insert({
      account_id: input.accountId,
      target_id: input.targetId ?? null,
      operation: input.operation,
      result: input.result,
      reason: input.reason,
      actor_type: input.actorType,
      batch_id: input.batchId ?? null,
      counts: input.counts ?? null,
      metadata_safe: {
        source: input.operation,
        source_surface: input.sourceSurface ?? "admin_dashboard",
        previous_status: input.previousStatus ?? null,
        next_status: input.nextStatus ?? null,
        ...(input.counts ?? {}),
      },
    });
  } catch {
    // CT audit is best-effort.
  }
}

async function tryEnqueueTargetVerificationJobs(
  supabase: ReturnType<typeof createSupabaseClient>,
  rows: SupabaseRecord[],
) {
  const jobRows = buildTargetVerificationJobPayloads(rows.map((row) => ({
    id: readString(row.id, ""),
    account_id: readString(row.account_id, ""),
    batch_id: readString(row.batch_id, "") || null,
    normalized_username: readString(row.normalized_username, readString(row.target_username, "")),
    target_username: readString(row.target_username, ""),
  })));

  if (jobRows.length === 0) return { queued: 0, error: null as string | null };

  const { error } = await supabase
    .from("ct_target_verification_jobs")
    .upsert(jobRows, { onConflict: "target_id", ignoreDuplicates: true });

  return { queued: error ? 0 : jobRows.length, error: error?.message ?? null };
}

function inlineBulkVerificationLimit(insertedCount: number) {
  const raw = process.env.CT_TARGET_BULK_INLINE_VERIFY_LIMIT?.trim();
  const parsed = raw ? Number(raw) : defaultInlineBulkVerificationLimit;
  const bounded = Number.isFinite(parsed) ? Math.trunc(parsed) : defaultInlineBulkVerificationLimit;
  return Math.min(Math.max(bounded, 0), Math.min(insertedCount, 10));
}

async function tryProcessQueuedTargetVerificationJobs(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: { rows: SupabaseRecord[]; batchId: string | null },
) {
  const limit = inlineBulkVerificationLimit(input.rows.length);
  if (limit <= 0) return null;
  const summary = {
    processed_count: 0,
    succeeded_count: 0,
    rejected_count: 0,
    review_count: 0,
    retry_scheduled_count: 0,
    provider_error_count: 0,
  };

  for (const row of input.rows.slice(0, limit)) {
    const targetId = readString(row.id, "");
    const accountId = readString(row.account_id, "");
    const normalizedUsername = readString(row.normalized_username, readString(row.target_username, ""));
    if (!targetId || !accountId || !normalizedUsername) continue;

    const now = new Date();
    try {
      const decision = await verifySingleTargetUsername(normalizedUsername);
      const jobDecision = buildTargetVerificationJobDecision({
        decision,
        attemptCount: 1,
        maxAttempts: 3,
        now,
      });
      await supabase
        .from("ig_targets")
        .update({
          ...jobDecision.targetPatch,
          updated_at: now.toISOString(),
        })
        .eq("id", targetId)
        .eq("account_id", accountId);
      await supabase
        .from("ct_target_verification_jobs")
        .update({
          status: jobDecision.jobStatus,
          next_attempt_at: jobDecision.nextAttemptAt,
          locked_at: null,
          locked_by: null,
          last_error_code: jobDecision.lastErrorCode,
          last_error_message: jobDecision.lastErrorMessage,
          provider_status: decision.verification_status,
          updated_at: now.toISOString(),
        })
        .eq("target_id", targetId);
      summary.processed_count += 1;
      if (jobDecision.jobStatus === "retry_scheduled") summary.retry_scheduled_count += 1;
      else if (jobDecision.targetPatch.status === "valid") summary.succeeded_count += 1;
      else if (jobDecision.targetPatch.status === "rejected") summary.rejected_count += 1;
      else if (jobDecision.targetPatch.status === "review") summary.review_count += 1;
    } catch {
      summary.provider_error_count += 1;
    }
  }

  return {
    batch_id: input.batchId,
    inline_limit: limit,
    summary,
    remaining_queued: Math.max(0, input.rows.length - summary.processed_count),
  };
}

export async function listAccountTargets(accountId: string): Promise<TargetsServiceResult<TargetSafeRow[]>> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_targets")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message, status: 500 };
  return { ok: true, data: ((data ?? []) as SupabaseRecord[]).map(safeTargetRow) };
}

export async function listAdminAccountTargets(accountId: string): Promise<TargetsServiceResult<TargetSafeRow[]>> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_targets")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });

  if (error) return { ok: false, error: error.message, status: 500 };
  return { ok: true, data: ((data ?? []) as SupabaseRecord[]).map(safeAdminTargetRow) };
}

export async function addAccountTargetSingle(
  accountId: string,
  targetUsername: string,
  ctx: TargetsServiceContext,
  followersCountInput?: number | string | null,
): Promise<TargetsServiceResult<{
  row: TargetSafeRow;
  validation_pending: boolean;
  verification_status: string;
  quality_status: string;
  avatar_status: "resolved" | "unavailable";
}>> {
  const supabase = createSupabaseClient();
  const now = new Date().toISOString();
  const single = normalizeTargetUsername(targetUsername);
  if (!single || !isValidTargetUsername(single)) {
    await tryRecordTargetAudit(supabase, {
      accountId,
      operation: "target_add_single",
      result: "failed",
      reason: "invalid_syntax",
      actorType: ctx.actorType,
      sourceSurface: ctx.sourceSurface,
    });
    return { ok: false, error: "Invalid Instagram username.", status: 400 };
  }

  const { data: dupRows, error: dupError } = await supabase
    .from("ig_targets")
    .select("*")
    .eq("account_id", accountId);

  if (dupError) return { ok: false, error: dupError.message, status: 500 };
  const existingRows = (dupRows ?? []) as SupabaseRecord[];
  const readdBlock = await rejectBlockedTargetReadd(supabase, accountId, existingRows, single, ctx, "target_add_single");
  if (readdBlock) return readdBlock;
  const dup = existingRows.find((row) => activeExistingUsername(row) === single);
  if (dup) {
    await tryRecordTargetAudit(supabase, {
      accountId,
      operation: "target_add_single",
      result: "duplicate",
      reason: "duplicate_existing",
      actorType: ctx.actorType,
      sourceSurface: ctx.sourceSurface,
    });
    return { ok: false, error: "This target account is already in the database.", status: 409 };
  }

  const providedFollowersCount =
    typeof followersCountInput === "undefined" || followersCountInput === null
      ? null
      : readNumber(followersCountInput, Number.NaN);
  const followersCount = Number.isFinite(providedFollowersCount) ? providedFollowersCount : null;
  const followersError = validateKnownFollowersCount(followersCount);
  if (followersError) return { ok: false, error: followersError, status: 400 };

  const providerDecision = await verifySingleTargetUsername(single);
  const decision = followersCount !== null && providerDecision.verification_status === "pending"
    ? { ...providerDecision, followers_count: followersCount }
    : providerDecision;
  const insertPayload = targetInsertPayload({
    accountId,
    inputUsername: targetUsername,
    normalizedUsername: single,
    source: targetSourceForAdd("single", ctx),
    actorType: ctx.actorType,
    now,
    decision,
  });

  const { data: row, error: insertError } = await supabase
    .from("ig_targets")
    .insert(insertPayload)
    .select("*")
    .single();

  if (insertError) return { ok: false, error: insertError.message, status: 500 };
  const safeRow = safeTargetRow(row as SupabaseRecord);
  await tryRecordTargetAudit(supabase, {
    accountId,
    operation: "target_add_single",
    result: decision.status === "valid" || decision.status === "pending_verification"
      ? "accepted"
      : decision.status === "rejected"
        ? "rejected"
        : "review",
    reason: decision.verification_reason,
    actorType: ctx.actorType,
    sourceSurface: ctx.sourceSurface,
    targetId: safeRow.id,
  });
  await reevaluateNeedsMoreTargetAccountsAfterTargetMutation(accountId, "target_add_single");
  return {
    ok: true,
    data: {
      row: safeRow,
      validation_pending: decision.verification_status === "pending",
      verification_status: decision.verification_status,
      quality_status: decision.quality_status,
      avatar_status: safeRow.avatarAvailable ? "resolved" : "unavailable",
    },
    status: 201,
  };
}

export async function addAccountTargetsBulk(
  accountId: string,
  usernames: string[],
  ctx: TargetsServiceContext,
): Promise<TargetsServiceResult<Record<string, unknown>>> {
  const supabase = createSupabaseClient();
  const now = new Date().toISOString();

  const { data: existingRows, error: existingError } = await supabase
    .from("ig_targets")
    .select("*")
    .eq("account_id", accountId);

  if (existingError) return { ok: false, error: existingError.message, status: 500 };

  const existingUsernames = ((existingRows ?? []) as SupabaseRecord[])
    .map(activeExistingUsername)
    .filter(Boolean);
  const classified = classifyBulkTargetLines(
    usernames.map((u) => readString(u, "")),
    existingUsernames,
  );
  for (const line of classified) {
    if (line.status === "invalid_syntax" || line.status === "duplicate_in_batch" || line.status === "duplicate_existing") continue;
    const readdBlock = await rejectBlockedTargetReadd(
      supabase,
      accountId,
      (existingRows ?? []) as SupabaseRecord[],
      line.normalized_username,
      ctx,
      "target_add_bulk",
    );
    if (readdBlock) return readdBlock;
  }
  const summary = summarizeBulkTargetLines(classified);
  const accepted = classified.filter((line) => line.status === "pending_verification");
  const batchId = accepted.length > 0 ? crypto.randomUUID() : null;
  const source = targetSourceForAdd("bulk", ctx);
  const enriched = await enrichBulkTargetLinesWithProvider(accepted, 3);
  let avatarResolved = 0;
  let avatarUnavailable = 0;

  const rows = enriched.map(({ line, decision, avatarStatus }) => {
    if (avatarStatus === "resolved") avatarResolved += 1;
    else avatarUnavailable += 1;
    return targetInsertPayload({
      accountId,
      inputUsername: line.input_username,
      normalizedUsername: line.normalized_username,
      source,
      actorType: ctx.actorType,
      now,
      batchId,
      decision,
    });
  });

  const insertResult = rows.length > 0
    ? await supabase.from("ig_targets").insert(rows).select("*")
    : { data: [], error: null };

  if (insertResult.error) {
    await tryRecordTargetAudit(supabase, {
      accountId,
      operation: "target_add_bulk",
      result: "failed",
      reason: "target_bulk_insert_failed",
      actorType: ctx.actorType,
      sourceSurface: ctx.sourceSurface,
      batchId,
      counts: summary,
    });
    return { ok: false, error: insertResult.error.message, status: 500 };
  }

  const jobResult = await tryEnqueueTargetVerificationJobs(
    supabase,
    (insertResult.data ?? []) as SupabaseRecord[],
  );
  if (jobResult.error) {
    await tryRecordTargetAudit(supabase, {
      accountId,
      operation: "target_add_bulk",
      result: "failed",
      reason: "target_verification_job_enqueue_failed",
      actorType: ctx.actorType,
      sourceSurface: ctx.sourceSurface,
      batchId,
      counts: summary,
    });
    return { ok: false, error: "Targets were inserted, but verification jobs could not be queued.", status: 500 };
  }
  const verificationRun = await tryProcessQueuedTargetVerificationJobs(supabase, {
    rows: (insertResult.data ?? []) as SupabaseRecord[],
    batchId,
  });

  await tryRecordTargetAudit(supabase, {
    accountId,
    operation: "target_add_bulk",
    result: rows.length > 0 ? "accepted" : summary.already_existing || summary.duplicates ? "duplicate" : "failed",
    reason: "bulk_import_classified",
    actorType: ctx.actorType,
    sourceSurface: ctx.sourceSurface,
    batchId,
    counts: summary,
  });
  await reevaluateNeedsMoreTargetAccountsAfterTargetMutation(accountId, "target_add_bulk");

  return {
    ok: true,
    data: {
      batch_id: batchId,
      inserted: insertResult.data?.length ?? 0,
      skipped_duplicates: summary.duplicates + summary.already_existing,
      skipped_deleted: 0,
      skipped_invalid: summary.invalid,
      validation_pending: insertResult.data?.length ?? 0,
      jobs_queued: jobResult.queued,
      job_status: verificationRun ? "processed_inline_or_remaining_queued" : jobResult.queued > 0 ? "queued" : "not_created",
      verification_run: verificationRun,
      summary,
      lines: classified,
      rows: ((insertResult.data ?? []) as SupabaseRecord[]).map(safeTargetRow),
      avatar_resolved: avatarResolved,
      avatar_unavailable: avatarUnavailable,
    },
  };
}

export async function archiveAccountTargets(
  accountId: string,
  ids: string[],
  ctx: TargetsServiceContext,
): Promise<TargetsServiceResult<{ archived: number }>> {
  if (ids.length === 0) return { ok: false, error: "Missing ids.", status: 400 };

  const supabase = createSupabaseClient();
  const { data: owned, error: selError } = await supabase
    .from("ig_targets")
    .select("id, status")
    .eq("account_id", accountId)
    .in("id", ids);

  if (selError) return { ok: false, error: selError.message, status: 500 };

  const ownedIds = new Set((owned ?? []).map((r: SupabaseRecord) => readString(r.id, "")));
  for (const id of ids) {
    if (!ownedIds.has(id)) {
      return { ok: false, error: "One or more targets do not belong to this account.", status: 400 };
    }
  }

  const archiveReason = ctx.sourceSurface === "client_dashboard" ? "client_dashboard_archive" : "dashboard_archive";
  const now = new Date().toISOString();
  const { data: archivedRows, error } = await supabase
    .from("ig_targets")
    .update({
      status: "archived",
      archived_at: now,
      archive_reason: archiveReason,
      ...clearPeriodicSchedulePatch(),
      updated_at: now,
    })
    .eq("account_id", accountId)
    .in("id", ids)
    .select("id, status");

  if (error) return { ok: false, error: error.message, status: 500 };
  await Promise.all(((archivedRows ?? []) as SupabaseRecord[]).map((row) => tryRecordTargetAudit(supabase, {
    accountId,
    operation: "target_archive",
    result: "archived",
    reason: archiveReason,
    actorType: ctx.actorType,
    sourceSurface: ctx.sourceSurface,
    targetId: readString(row.id, ""),
    previousStatus: readString(((owned ?? []) as SupabaseRecord[]).find((candidate) => readString(candidate.id, "") === readString(row.id, ""))?.status, "unknown"),
    nextStatus: "archived",
  })));
  await reevaluateNeedsMoreTargetAccountsAfterTargetMutation(accountId, "target_archive");
  return { ok: true, data: { archived: ids.length } };
}

export async function restoreAccountTarget(
  accountId: string,
  targetId: string,
  ctx: TargetsServiceContext,
): Promise<TargetsServiceResult<{ row: TargetSafeRow; restored: number; jobs_queued: number; reason: string }>> {
  const supabase = createSupabaseClient();
  const { data: accountRows, error: selError } = await supabase
    .from("ig_targets")
    .select("*")
    .eq("account_id", accountId);

  if (selError) return { ok: false, error: selError.message, status: 500 };

  const rows = (accountRows ?? []) as SupabaseRecord[];
  const row = rows.find((candidate) => readString(candidate.id, "") === targetId);
  if (!row) return { ok: false, error: "Target does not belong to this account.", status: 400 };
  if (isDeletedTargetLifecycle(row)) return { ok: false, error: "Deleted targets cannot be restored from this action.", status: 409 };
  if (!isArchivedTargetLifecycle(row)) return { ok: false, error: "Only archived targets can be restored.", status: 409 };
  if (
    readString(row.archive_reason, "") === TARGET_AUTO_ARCHIVE_LOW_FBR_ARCHIVE_REASON
    && !shouldAllowAutoArchiveRestoreOverride(ctx.actorType)
  ) {
    const block = evaluateTargetReaddBlock(rows, readString(row.normalized_username, readString(row.target_username, "")));
    return {
      ok: false,
      error: ctx.actorType === "client"
        ? (block.clientMessageFr ?? "Ce compte cible a été mis de côté pour cette campagne.")
        : "Restore is blocked for targets set aside by the low performance policy. Admin override env is required.",
      status: 409,
    };
  }
  if (hasActiveDuplicateForRestore(row, rows)) return { ok: false, error: "duplicate_existing_active", status: 409 };

  const previousStatus = readString(row.status, "unknown");
  const decision = buildRestoreLifecycleDecision(row, new Date());
  let jobsQueued = 0;
  if (decision.shouldQueueVerification) {
    const { error: jobError } = await supabase
      .from("ct_target_verification_jobs")
      .upsert({
        target_id: targetId,
        account_id: accountId,
        batch_id: readString(row.batch_id, "") || null,
        normalized_username: normalizeTargetUsername(readString(row.normalized_username, readString(row.target_username, ""))),
        status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        locked_at: null,
        locked_by: null,
        last_error_code: null,
        last_error_message: null,
        provider_status: "pending",
        metadata_safe: { source: "target_restore" },
      }, { onConflict: "target_id" });
    if (jobError) return { ok: false, error: "Verification could not be queued for restore.", status: 500 };
    jobsQueued = 1;
  }

  const { data: restoredRow, error: updateError } = await supabase
    .from("ig_targets")
    .update({
      ...decision.targetPatch,
      ...buildRestorePeriodicSchedulePatch(targetId, new Date()),
    })
    .eq("account_id", accountId)
    .eq("id", targetId)
    .select("*")
    .single();

  if (updateError) return { ok: false, error: updateError.message, status: 500 };

  const safeRow = safeTargetRow(restoredRow as SupabaseRecord);
  await tryRecordTargetAudit(supabase, {
    accountId,
    operation: "target_restore",
    result: "restored",
    reason: decision.auditReason,
    actorType: ctx.actorType,
    sourceSurface: ctx.sourceSurface,
    targetId: safeRow.id,
    previousStatus,
    nextStatus: safeRow.status,
  });

  await reevaluateNeedsMoreTargetAccountsAfterTargetMutation(accountId, "target_restore");
  return { ok: true, data: { row: safeRow, restored: 1, jobs_queued: jobsQueued, reason: decision.auditReason } };
}
