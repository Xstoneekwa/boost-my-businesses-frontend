import { createSupabaseClient } from "@/lib/supabase";
import {
  safeInstagramPublicAvatarUrl,
} from "@/lib/instagram-public-profile-lookup";
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
import {
  getAccountId,
  jsonError,
  jsonOk,
  readJsonBody,
  readNumber,
  readString,
  requireInstagramAdmin,
  type SupabaseRecord,
} from "../_utils";
import { relayAuthStatus, verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";
const defaultInlineBulkVerificationLimit = 5;

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Targets relay authentication failed.", relayAuthStatus(relayAuth.reason), { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

type SafeTargetRow = {
  target_id: string;
  id: string;
  account_id: string;
  input_username?: string | null;
  normalized_username?: string | null;
  canonical_username?: string | null;
  target_username: string;
  status: string;
  verification_status?: string | null;
  verification_reason?: string | null;
  quality_status?: string | null;
  avatar_url?: string | null;
  source: string;
  actor_type?: string | null;
  archive_reason?: string | null;
  rejected_reason?: string | null;
  batch_id?: string | null;
  provider_checked_at?: string | null;
  created_at: string;
  updated_at: string;
  followers_count?: number | null;
  is_verified?: boolean | null;
  is_private?: boolean | null;
  followback_ratio?: number | null;
  follows_sent_count?: number | null;
  followbacks_count?: number | null;
  performance_status?: "pending" | "insufficient_data" | "good" | "avg" | "bad" | "not_applicable";
  followsSent?: number | null;
  followbacks?: number | null;
  fbrPercent?: number | null;
  performanceStatus?: "pending" | "insufficient_data" | "good" | "avg" | "bad" | "not_applicable";
  last_selected_at?: string | null;
  last_used_at?: string | null;
  last_successful_candidate_at?: string | null;
  last_exhausted_at?: string | null;
  exhaustion_reason?: string | null;
  cooldown_until?: string | null;
  metrics_updated_at?: string | null;
  lastSelectedAt?: string | null;
  lastUsedAt?: string | null;
  lastSuccessfulCandidateAt?: string | null;
  lastExhaustedAt?: string | null;
  exhaustionReason?: string | null;
  cooldownUntil?: string | null;
  metricsUpdatedAt?: string | null;
  added_at?: string | null;
  deleted_at?: string | null;
  archived_at?: string | null;
};

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
): SafeTargetRow["performance_status"] {
  if (qualityStatus !== "eligible") return "not_applicable";
  if (followsSent === null || followsSent <= 0) return "pending";
  if (followsSent < 100) return "insufficient_data";
  if (fbrPercent === null) return "pending";
  if (fbrPercent <= 8) return "bad";
  if (fbrPercent < 15) return "avg";
  return "good";
}

function safeTargetRow(row: SupabaseRecord): SafeTargetRow {
  const createdAt = readString(row.created_at, "");
  const followersCount = readNumber(row.followers_count ?? row.followers, Number.NaN);
  const followsSentCount = readNumber(row.follows_sent_count, Number.NaN);
  const followbacksCount = readNumber(row.followbacks_count, Number.NaN);
  const storedFollowbackRatio = readNumber(row.followback_ratio ?? row.fbr_percent, Number.NaN);
  const followbackRatio = Number.isFinite(storedFollowbackRatio)
    ? storedFollowbackRatio
    : Number.isFinite(followsSentCount) && followsSentCount > 0 && Number.isFinite(followbacksCount)
      ? (followbacksCount / followsSentCount) * 100
      : Number.NaN;
  const id = readString(row.id ?? row.target_id, "");
  const targetUsername = normalizeTargetUsername(
    readString(row.normalized_username, readString(row.target_username, readString(row.input_username, ""))),
  );
  const qualityStatus = readString(row.quality_status, "unknown");
  const safeFbr = Number.isFinite(followbackRatio) ? followbackRatio : null;
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
    avatar_url: safeInstagramPublicAvatarUrl(readString(row.avatar_url, "")),
    source: readString(row.source, "unknown"),
    actor_type: readString(row.actor_type, "") || null,
    archive_reason: readString(row.archive_reason, "") || null,
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
    sourceSurface?: "admin_dashboard" | "client_dashboard" | "botapp" | "backend" | "automation";
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
    // CT audit is best-effort until every environment has the CT-1 migration.
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

export async function GET(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const accountId = getAccountId(request);
    if (!accountId) return jsonError("Missing account_id.", 400);

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("ig_targets")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (error) return jsonError(error.message, 500);
    return jsonOk(((data ?? []) as SupabaseRecord[]).map(safeTargetRow));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load targets.";
    return jsonError(message, 500);
  }
}

type PostBody = {
  account_id?: string;
  target_username?: string;
  usernames?: string[];
  followers_count?: number | string | null;
  actor_type?: TargetActorType;
};

export async function POST(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<PostBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);
    const actorType: TargetActorType = body.actor_type === "client" ? "client" : "admin";

    const supabase = createSupabaseClient();
    const now = new Date().toISOString();

    if (Array.isArray(body.usernames)) {
      const { data: existingRows, error: existingError } = await supabase
        .from("ig_targets")
        .select("*")
        .eq("account_id", accountId);

      if (existingError) return jsonError(existingError.message, 500);

      const existingUsernames = ((existingRows ?? []) as SupabaseRecord[])
        .map(activeExistingUsername)
        .filter(Boolean);
      const classified = classifyBulkTargetLines(
        body.usernames.map((u) => readString(u, "")),
        existingUsernames,
      );
      const summary = summarizeBulkTargetLines(classified);
      const accepted = classified.filter((line) => line.status === "pending_verification");
      const batchId = accepted.length > 0 ? crypto.randomUUID() : null;

      const rows = accepted.map((line) =>
        targetInsertPayload({
          accountId,
          inputUsername: line.input_username,
          normalizedUsername: line.normalized_username,
          source: "manual_bulk",
          actorType,
          now,
          batchId,
          decision: pendingTargetVerificationDecision("queued_for_future_verification"),
        }),
      );

      const insertResult = rows.length > 0
        ? await supabase.from("ig_targets").insert(rows).select("*")
        : { data: [], error: null };

      if (insertResult.error) {
        await tryRecordTargetAudit(supabase, {
          accountId,
          operation: "target_add_bulk",
          result: "failed",
          reason: "target_bulk_insert_failed",
          actorType,
          batchId,
          counts: summary,
        });
        return jsonError(insertResult.error.message, 500);
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
          actorType,
          batchId,
          counts: summary,
        });
        return jsonError("Targets were inserted, but verification jobs could not be queued.", 500);
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
        actorType,
        batchId,
        counts: summary,
      });

      return jsonOk({
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
      });
    }

    const single = normalizeTargetUsername(readString(body.target_username, ""));
    if (!single || !isValidTargetUsername(single)) {
      await tryRecordTargetAudit(supabase, {
        accountId,
        operation: "target_add_single",
        result: "failed",
        reason: "invalid_syntax",
        actorType,
      });
      return jsonError("Invalid Instagram username.", 400);
    }

    const { data: dupRows, error: dupError } = await supabase
      .from("ig_targets")
      .select("*")
      .eq("account_id", accountId);

    if (dupError) return jsonError(dupError.message, 500);
    const dup = ((dupRows ?? []) as SupabaseRecord[]).find((row) => activeExistingUsername(row) === single);
    if (dup) {
      await tryRecordTargetAudit(supabase, {
        accountId,
        operation: "target_add_single",
        result: "duplicate",
        reason: "duplicate_existing",
        actorType,
      });
      return jsonError("This target account is already in the database.", 409);
    }

    const providedFollowersCount =
      typeof body.followers_count === "undefined" || body.followers_count === null
        ? null
        : readNumber(body.followers_count, Number.NaN);
    const followersCount = Number.isFinite(providedFollowersCount) ? providedFollowersCount : null;
    const followersError = validateKnownFollowersCount(followersCount);
    if (followersError) return jsonError(followersError, 400);

    const providerDecision = await verifySingleTargetUsername(single);
    const decision = followersCount !== null && providerDecision.verification_status === "pending"
      ? { ...providerDecision, followers_count: followersCount }
      : providerDecision;
    const insertPayload = targetInsertPayload({
      accountId,
      inputUsername: readString(body.target_username, ""),
      normalizedUsername: single,
      source: "manual_single",
      actorType,
      now,
      decision,
    });

    const { data: row, error: insertError } = await supabase
      .from("ig_targets")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError) return jsonError(insertError.message, 500);
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
      actorType,
      targetId: safeRow.id,
    });
    return jsonOk({
      row: safeRow,
      validation_pending: decision.verification_status === "pending",
      verification_status: decision.verification_status,
      quality_status: decision.quality_status,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create targets.";
    return jsonError(message, 500);
  }
}

type DeleteBody = {
  account_id?: string;
  ids?: string[];
  actor_type?: TargetActorType;
};

export async function DELETE(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<DeleteBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);
    const actorType: TargetActorType = body.actor_type === "client" ? "client" : "admin";

    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => readString(id, "").trim()).filter(Boolean)
      : [];

    if (ids.length === 0) return jsonError("Missing ids.", 400);

    const supabase = createSupabaseClient();

    const { data: owned, error: selError } = await supabase
      .from("ig_targets")
      .select("id, status")
      .eq("account_id", accountId)
      .in("id", ids);

    if (selError) return jsonError(selError.message, 500);

    const ownedIds = new Set((owned ?? []).map((r: SupabaseRecord) => readString(r.id, "")));
    for (const id of ids) {
      if (!ownedIds.has(id)) {
        return jsonError("One or more targets do not belong to this account.", 400);
      }
    }

    const now = new Date().toISOString();
    const { data: archivedRows, error } = await supabase
      .from("ig_targets")
      .update({
        status: "archived",
        archived_at: now,
        archive_reason: "dashboard_archive",
        updated_at: now,
      })
      .eq("account_id", accountId)
      .in("id", ids)
      .select("id, status");

    if (error) return jsonError(error.message, 500);
    await Promise.all(((archivedRows ?? []) as SupabaseRecord[]).map((row) => tryRecordTargetAudit(supabase, {
      accountId,
      operation: "target_archive",
      result: "archived",
      reason: "dashboard_archive",
      actorType,
      sourceSurface: "admin_dashboard",
      targetId: readString(row.id, ""),
      previousStatus: readString(((owned ?? []) as SupabaseRecord[]).find((candidate) => readString(candidate.id, "") === readString(row.id, ""))?.status, "unknown"),
      nextStatus: "archived",
    })));
    return jsonOk({ archived: ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive targets.";
    return jsonError(message, 500);
  }
}

type PatchBody = {
  account_id?: string;
  id?: string;
  ids?: string[];
  action?: "restore" | "unarchive";
  actor_type?: TargetActorType;
};

export async function PATCH(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<PatchBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);
    const action = readString(body.action, "").toLowerCase();
    if (action !== "restore" && action !== "unarchive") return jsonError("Unsupported target lifecycle action.", 400);
    const actorType: TargetActorType = body.actor_type === "client" ? "client" : "admin";

    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => readString(id, "").trim()).filter(Boolean)
      : [readString(body.id, "").trim()].filter(Boolean);
    if (ids.length !== 1) return jsonError("Restore expects exactly one target id.", 400);

    const supabase = createSupabaseClient();
    const { data: accountRows, error: selError } = await supabase
      .from("ig_targets")
      .select("*")
      .eq("account_id", accountId);

    if (selError) return jsonError(selError.message, 500);

    const rows = (accountRows ?? []) as SupabaseRecord[];
    const row = rows.find((candidate) => readString(candidate.id, "") === ids[0]);
    if (!row) return jsonError("Target does not belong to this account.", 400);
    if (isDeletedTargetLifecycle(row)) return jsonError("Deleted targets cannot be restored from this action.", 409);
    if (!isArchivedTargetLifecycle(row)) return jsonError("Only archived targets can be restored.", 409);
    if (hasActiveDuplicateForRestore(row, rows)) return jsonError("duplicate_existing_active", 409);

    const previousStatus = readString(row.status, "unknown");
    const decision = buildRestoreLifecycleDecision(row, new Date());
    let jobsQueued = 0;
    if (decision.shouldQueueVerification) {
      const { error: jobError } = await supabase
        .from("ct_target_verification_jobs")
        .upsert({
          target_id: ids[0],
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
      if (jobError) return jsonError("Verification could not be queued for restore.", 500);
      jobsQueued = 1;
    }

    const { data: restoredRow, error: updateError } = await supabase
      .from("ig_targets")
      .update(decision.targetPatch)
      .eq("account_id", accountId)
      .eq("id", ids[0])
      .select("*")
      .single();

    if (updateError) return jsonError(updateError.message, 500);

    const safeRow = safeTargetRow(restoredRow as SupabaseRecord);
    await tryRecordTargetAudit(supabase, {
      accountId,
      operation: "target_restore",
      result: "restored",
      reason: decision.auditReason,
      actorType,
      sourceSurface: "admin_dashboard",
      targetId: safeRow.id,
      previousStatus,
      nextStatus: safeRow.status,
    });

    return jsonOk({ row: safeRow, restored: 1, jobs_queued: jobsQueued, reason: decision.auditReason });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to restore target.";
    return jsonError(message, 500);
  }
}
