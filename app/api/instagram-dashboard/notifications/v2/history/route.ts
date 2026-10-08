import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Notification Router V2 history");
  if (unauthorized) return unauthorized;
  const url = new URL(request.url);
  const destinationId = String(url.searchParams.get("destination_id") || "").trim();
  if (!destinationId) return jsonError("Destination is required.", 400);
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from("notification_deliveries")
    .select("id,status,attempt_count,next_retry_at,sent_at,last_error_summary,created_at,updated_at")
    .eq("destination_id", destinationId).order("created_at", { ascending: false }).limit(12);
  if (error) return jsonError("Notification history is unavailable.", 503);
  return jsonOk({ deliveries: data ?? [] });
}
