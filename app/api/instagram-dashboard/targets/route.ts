import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  type SupabaseRecord,
} from "../_utils";

export const dynamic = "force-dynamic";

function normalizeTargetUsername(raw: string): string {
  return raw.trim().replace(/^@+/g, "").toLowerCase();
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
    return jsonOk(data ?? []);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load targets.";
    return jsonError(message, 500);
  }
}

type PostBody = {
  account_id?: string;
  target_username?: string;
  usernames?: string[];
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
      const normalized = [
        ...new Set(
          body.usernames
            .map((u) => normalizeTargetUsername(readString(u, "")))
            .filter(Boolean),
        ),
      ];

      if (normalized.length === 0) {
        return jsonError("No valid usernames after cleanup.", 400);
      }

      const { data: existingRows, error: existingError } = await supabase
        .from("ig_targets")
        .select("target_username")
        .eq("account_id", accountId);

      if (existingError) return jsonError(existingError.message, 500);

      const existing = new Set(
        (existingRows ?? []).map((r: SupabaseRecord) =>
          normalizeTargetUsername(readString(r.target_username, "")),
        ),
      );

      const toInsert = normalized.filter((u) => !existing.has(u));

      if (toInsert.length === 0) {
        return jsonOk({
          inserted: 0,
          skipped_duplicates: normalized.length,
          rows: [],
        });
      }

      const rows = toInsert.map((target_username) => ({
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
        skipped_duplicates: normalized.length - toInsert.length,
        rows: inserted ?? [],
      });
    }

    const single = normalizeTargetUsername(readString(body.target_username, ""));
    if (!single) return jsonError("Missing or invalid target_username.", 400);

    const { data: dup, error: dupError } = await supabase
      .from("ig_targets")
      .select("id")
      .eq("account_id", accountId)
      .eq("target_username", single)
      .maybeSingle();

    if (dupError) return jsonError(dupError.message, 500);
    if (dup) return jsonError("Duplicate target for this account.", 409);

    const { data: row, error: insertError } = await supabase
      .from("ig_targets")
      .insert({
        account_id: accountId,
        target_username: single,
        status: "pending",
        source: "dashboard_manual",
        created_at: now,
        updated_at: now,
      })
      .select("*")
      .single();

    if (insertError) return jsonError(insertError.message, 500);
    return jsonOk(row, 201);
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
