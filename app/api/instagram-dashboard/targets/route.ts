import { createSupabaseClient } from "@/lib/supabase";
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
  id: string;
  account_id: string;
  target_username: string;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  followers_count?: number | null;
  followback_ratio?: number | null;
  added_at?: string | null;
  deleted_at?: string | null;
  archived_at?: string | null;
};

function normalizeTargetUsername(raw: string): string {
  return raw.trim().replace(/^@+/g, "").toLowerCase();
}

function isValidTargetUsername(username: string) {
  return /^[a-z0-9._]{1,30}$/.test(username);
}

function readDateString(row: SupabaseRecord, key: string) {
  return readString(row[key], "") || null;
}

function safeTargetRow(row: SupabaseRecord): SafeTargetRow {
  const createdAt = readString(row.created_at, "");
  const followersCount = readNumber(row.followers_count ?? row.followers, Number.NaN);
  const followbackRatio = readNumber(row.followback_ratio ?? row.fbr_percent, Number.NaN);

  return {
    id: readString(row.id, ""),
    account_id: readString(row.account_id, ""),
    target_username: readString(row.target_username, ""),
    status: readString(row.status, "unknown"),
    source: readString(row.source, "unknown"),
    created_at: createdAt,
    updated_at: readString(row.updated_at, createdAt),
    followers_count: Number.isFinite(followersCount) ? followersCount : null,
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
};

export async function POST(request: Request) {
  try {
    const unauthorized = await requireInstagramAdmin();
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<PostBody>(request);
    if (!body) return jsonError("Invalid JSON body.", 400);

    const accountId = readString(body.account_id, "").trim();
    if (!accountId) return jsonError("Missing account_id.", 400);

    const supabase = createSupabaseClient();
    const now = new Date().toISOString();

    if (Array.isArray(body.usernames)) {
      const cleaned = [
        ...new Set(
          body.usernames
            .map((u) => normalizeTargetUsername(readString(u, "")))
            .filter(Boolean),
        ),
      ];
      if (cleaned.length === 0 || cleaned.some((username) => !isValidTargetUsername(username))) {
        return jsonError("Invalid Instagram username.", 400);
      }

      const { data: existingRows, error: existingError } = await supabase
        .from("ig_targets")
        .select("*")
        .eq("account_id", accountId);

      if (existingError) return jsonError(existingError.message, 500);

      const existing = new Map(
        ((existingRows ?? []) as SupabaseRecord[]).map((row) => [
          normalizeTargetUsername(readString(row.target_username, "")),
          row,
        ]),
      );
      const deleted = cleaned.find((username) => {
        const existingRow = existing.get(username);
        return existingRow ? isDeletedTarget(existingRow) : false;
      });
      if (deleted) {
        return jsonError("This target account was previously deleted and cannot be re-added automatically.", 409);
      }
      if (cleaned.some((username) => existing.has(username))) {
        return jsonError("This target account is already in the database.", 409);
      }

      // TODO: Replace this admin fallback with validate_target_account(username)
      // / Target Discovery validation before client-dashboard inserts are allowed.
      const rows = cleaned.map((target_username) => ({
        account_id: accountId,
        target_username,
        status: "pending",
        source: "dashboard_bulk",
        created_at: now,
        updated_at: now,
      }));

      const { data: inserted, error: insertError } = await supabase.from("ig_targets").insert(rows).select("*");

      if (insertError) return jsonError(insertError.message, 500);

      return jsonOk({
        inserted: inserted?.length ?? 0,
        skipped_duplicates: 0,
        skipped_deleted: 0,
        skipped_invalid: 0,
        validation_pending: inserted?.length ?? 0,
        rows: ((inserted ?? []) as SupabaseRecord[]).map(safeTargetRow),
      });
    }

    const single = normalizeTargetUsername(readString(body.target_username, ""));
    if (!single || !isValidTargetUsername(single)) {
      return jsonError("Invalid Instagram username.", 400);
    }

    const { data: dup, error: dupError } = await supabase
      .from("ig_targets")
      .select("*")
      .eq("account_id", accountId)
      .eq("target_username", single)
      .maybeSingle();

    if (dupError) return jsonError(dupError.message, 500);
    if (dup && isDeletedTarget(dup as SupabaseRecord)) {
      return jsonError("This target account was previously deleted and cannot be re-added automatically.", 409);
    }
    if (dup) return jsonError("This target account is already in the database.", 409);

    const providedFollowersCount =
      typeof body.followers_count === "undefined" || body.followers_count === null
        ? null
        : readNumber(body.followers_count, Number.NaN);
    const followersCount = Number.isFinite(providedFollowersCount) ? providedFollowersCount : null;
    const followersError = validateKnownFollowersCount(followersCount);
    if (followersError) return jsonError(followersError, 400);

    // TODO: Future validate_target_account(username) service must verify the Instagram
    // account exists, normalize username, fetch followers_count, enforce the 500-50000
    // range, reject deleted/archived/blacklisted/filtered targets, and confirm restore
    // rules before client-dashboard inserts are allowed.
    const insertPayload: Record<string, unknown> = {
      account_id: accountId,
      target_username: single,
      status: "pending",
      source: "dashboard_manual",
      created_at: now,
      updated_at: now,
    };
    if (followersCount !== null) insertPayload.followers_count = followersCount;

    const { data: row, error: insertError } = await supabase
      .from("ig_targets")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError) return jsonError(insertError.message, 500);
    return jsonOk({ row: safeTargetRow(row as SupabaseRecord), validation_pending: followersCount === null }, 201);
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

    const { error } = await supabase.from("ig_targets").delete().eq("account_id", accountId).in("id", ids);

    if (error) return jsonError(error.message, 500);
    return jsonOk({ deleted: ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete targets.";
    return jsonError(message, 500);
  }
}
