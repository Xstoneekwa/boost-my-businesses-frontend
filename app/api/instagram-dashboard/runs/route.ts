import { createSupabaseClient } from "@/lib/supabase";
import { getAccountId, jsonError, jsonOk, readDate, readString, requireInstagramAdmin, validateAccountId, type SupabaseRecord } from "../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("ig_runs")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return jsonError(error.message, 500);
    }

    const runs = ((data ?? []) as SupabaseRecord[]).map((row, index) => ({
      id: readString(row.id, readString(row.run_id, `${index}`)),
      status: readString(row.status, readString(row.run_status, "unknown")),
      started_at: readDate(row.started_at ?? row.created_at),
      finished_at: readDate(row.finished_at ?? row.updated_at),
    }));

    return jsonOk(runs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load account runs.";
    return jsonError(message, 500);
  }
}
