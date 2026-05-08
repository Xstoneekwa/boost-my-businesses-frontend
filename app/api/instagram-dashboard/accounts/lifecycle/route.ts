import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

type LifecycleAction = "archive" | "trash" | "restore";

type LifecyclePayload = {
  account_id?: unknown;
  action?: unknown;
};

const lifecycleActions = new Set<LifecycleAction>(["archive", "trash", "restore"]);

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function missingLifecycleColumnError(message: string) {
  return message.toLowerCase().includes("column")
    ? "Missing Instagram account lifecycle columns. Apply lib/instagram-dashboard/ig-accounts-lifecycle.sql migration."
    : message;
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<LifecyclePayload>(request);
    const accountId = readString(body?.account_id, "").trim();
    const action = readString(body?.action, "").trim() as LifecycleAction;

    if (!accountId) {
      return jsonError("Missing account_id.", 400);
    }

    if (!lifecycleActions.has(action)) {
      return jsonError("Invalid lifecycle action.", 400);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const supabase = createSupabaseClient();
    const patch =
      action === "archive"
        ? {
            status: "archived",
            archived_at: nowIso,
            trashed_at: null,
            scheduled_trash_at: addDays(now, 30).toISOString(),
            scheduled_delete_at: null,
            restored_at: null,
          }
        : action === "trash"
          ? {
              status: "trashed",
              archived_at: null,
              trashed_at: nowIso,
              scheduled_trash_at: null,
              scheduled_delete_at: addDays(now, 30).toISOString(),
              restored_at: null,
            }
          : {
              status: "active",
              archived_at: null,
              trashed_at: null,
              scheduled_trash_at: null,
              scheduled_delete_at: null,
              restored_at: nowIso,
            };

    const { data, error } = await supabase
      .from("ig_accounts")
      .update(patch)
      .eq("id", accountId)
      .select("*")
      .maybeSingle();

    if (error) {
      return jsonError(missingLifecycleColumnError(error.message), 500);
    }

    if (!data) {
      return jsonError("Instagram account not found.", 404);
    }

    return jsonOk(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update Instagram account lifecycle.";
    return jsonError(message, 500);
  }
}
