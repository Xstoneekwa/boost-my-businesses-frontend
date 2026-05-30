import { createSupabaseClient } from "@/lib/supabase";
import {
  safeInstagramPublicAvatarUrl,
} from "@/lib/instagram-public-profile-lookup";
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

export const dynamic = "force-dynamic";

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

function safeTargetRow(row: SupabaseRecord): SafeTargetRow {
  const createdAt = readString(row.created_at, "");
  const followersCount = readNumber(row.followers_count ?? row.followers, Number.NaN);
  const followbackRatio = readNumber(row.followback_ratio ?? row.fbr_percent, Number.NaN);
  const id = readString(row.id ?? row.target_id, "");
  const targetUsername = normalizeTargetUsername(
    readString(row.normalized_username, readString(row.target_username, readString(row.input_username, ""))),
  );

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
    quality_status: readString(row.quality_status, "unknown"),
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
    followback_ratio: Number.isFinite(followbackRatio) ? followbackRatio : null,
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
  if (followersCount < 500) {
    return "This target account cannot be added because it has fewer than 500 followers.";
  }
  if (followersCount > 50000) {
    return "This target account cannot be added because it has more than 50,000 followers.";
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
    operation: "target_add_single" | "target_add_bulk" | "target_verify";
    result: "accepted" | "duplicate" | "rejected" | "review" | "failed";
    reason: string;
    actorType: TargetActorType;
    batchId?: string | null;
    targetId?: string | null;
    counts?: BulkTargetSummary;
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
      metadata_safe: input.counts ? { source: input.operation, ...input.counts } : { source: input.operation },
    });
  } catch {
    // CT audit is best-effort until every environment has the CT-1 migration.
  }
}

export async function GET(request: Request) {
  try {
    const unauthorized = await requireInstagramAdmin();
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
    const unauthorized = await requireInstagramAdmin();
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
};

export async function DELETE(request: Request) {
  try {
    const unauthorized = await requireInstagramAdmin();
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<DeleteBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);

    const ids = Array.isArray(body.ids)
      ? body.ids.map((id) => readString(id, "").trim()).filter(Boolean)
      : [];

    if (ids.length === 0) return jsonError("Missing ids.", 400);

    const supabase = createSupabaseClient();

    const { data: owned, error: selError } = await supabase
      .from("ig_targets")
      .select("id")
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
    const { error } = await supabase
      .from("ig_targets")
      .update({
        status: "archived",
        archived_at: now,
        archive_reason: "dashboard_archive",
        updated_at: now,
      })
      .eq("account_id", accountId)
      .in("id", ids);

    if (error) return jsonError(error.message, 500);
    return jsonOk({ archived: ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive targets.";
    return jsonError(message, 500);
  }
}
