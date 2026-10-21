import { dispatchNotificationBatch } from "@/lib/notification-router-v2/dispatcher";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Notification Router V2 dispatcher");
  if (unauthorized) return unauthorized;
  try {
    const deliveries = await dispatchNotificationBatch(20);
    return jsonOk({ claimed: deliveries.length, deliveries });
  } catch {
    return jsonError("Notification dispatch is unavailable.", 503);
  }
}
