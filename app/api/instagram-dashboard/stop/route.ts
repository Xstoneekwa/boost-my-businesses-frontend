import { createSupabaseClient } from "@/lib/supabase";
import { getAccountId, jsonError, jsonOk, readJsonBody, readString, requireInstagramAdmin, validateAccountId, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["running", "queued", "pending", "in_progress", "active"];

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<{ account_id?: unknown }>(request);
    const accountId = typeof body?.account_id === "string" ? body.account_id.trim() : getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const { data: activeRuns, error: runError } = await supabase
      .from("ig_runs")
      .select("*")
      .eq("account_id", accountId)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1);

    if (runError) {
      return jsonError(runError.message, 500);
    }

    const activeRun = ((activeRuns ?? []) as SupabaseRecord[])[0];
    const runRowId = activeRun ? readString(activeRun.id, "") : "";
    const runId = activeRun ? runRowId || readString(activeRun.run_id, "") : "";

    if (runId) {
      const updateQuery = supabase
        .from("ig_runs")
        .update({ status: "stopped", finished_at: new Date().toISOString() });
      const { error: updateError } = await (runRowId ? updateQuery.eq("id", runRowId) : updateQuery.eq("run_id", runId));

      if (updateError) {
        return jsonError(updateError.message, 500);
      }
    }

    const { error: logError } = await supabase.from("ig_action_logs").insert({
      account_id: accountId,
      run_id: runId || null,
      action_type: "run_stopped",
      status: "success",
      message: "Run stopped manually from dashboard",
      created_at: new Date().toISOString(),
    });

    if (logError) {
      return jsonError(logError.message, 500);
    }

    return jsonOk({
      stopped: Boolean(runId),
      message: runId ? "Run stopped." : "No active run found. Stop log added.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not stop the run.";
    return jsonError(message, 500);
  }
}
