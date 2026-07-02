import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readInteger, readString, requireRelayOrAdmin } from "../../../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Incident notification outbox");
    if (unauthorizedResponse) return unauthorizedResponse;

    const url = new URL(request.url);
    const channel = readString(url.searchParams.get("channel")).trim().toLowerCase();
    const limit = readInteger(url.searchParams.get("limit"), 50);
    const offset = readInteger(url.searchParams.get("offset"), 0);

    const supabase = createSupabaseClient();
    let query = supabase
      .from("account_incident_notifications")
      .select("id,incident_id,channel,status,attempt_count,delivery_key,delivered_at,last_error,created_at,updated_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + Math.max(1, limit) - 1);

    if (channel === "slack" || channel === "discord") {
      query = query.eq("channel", channel);
    }

    const { data, error, count } = await query;
    if (error) {
      return jsonError(error.message, 500);
    }

    return jsonOk({
      rows: (data ?? []).map((row) => ({
        id: row.id,
        incidentId: row.incident_id,
        channel: row.channel,
        status: row.status,
        attemptCount: row.attempt_count,
        deliveryKey: row.delivery_key,
        deliveredAt: row.delivered_at,
        lastError: typeof row.last_error === "string" ? row.last_error.slice(0, 240) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total: count ?? 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load notification outbox.";
    return jsonError(message, 500);
  }
}
