import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin, type SupabaseRecord } from "../../_utils";

export const dynamic = "force-dynamic";

type PatchBody = {
  account_id?: string;
  ids?: string[];
};

export async function PATCH(request: Request) {
  try {
    const unauthorized = await requireInstagramAdmin();
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<PatchBody>(request);
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
      .update({ status: "pending", updated_at: now })
      .eq("account_id", accountId)
      .in("id", ids);

    if (error) return jsonError(error.message, 500);
    return jsonOk({ reset: ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reset targets.";
    return jsonError(message, 500);
  }
}
