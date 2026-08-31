import { createSupabaseClient } from "@/lib/supabase";
import { isNotificationCategory, isNotificationChannel, isNotificationEnvironment } from "@/lib/notification-router-v2/contracts";
import { loadDestinationSecret, validateDestinationWebhook } from "@/lib/notification-router-v2/settings";
import { providerPayload, renderBusinessMessage, syntheticTestEvent } from "@/lib/notification-router-v2/templates";
import { jsonError, jsonOk, readJsonBody, requireRelayOrAdmin } from "../../../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Notification Router V2 synthetic test");
  if (unauthorized) return unauthorized;
  const body = await readJsonBody<Record<string, unknown>>(request) ?? {};
  if (!isNotificationCategory(body.category) || !isNotificationEnvironment(body.environment) || !isNotificationChannel(body.channel)) {
    return jsonError("Invalid notification destination.", 400);
  }
  const supabase = createSupabaseClient();
  const { data: row } = await supabase.from("notification_destination_settings").select("id").eq("category", body.category).eq("environment", body.environment).eq("channel", body.channel).single();
  if (!row?.id) return jsonError("Notification destination not found.", 404);
  try {
    const destination = await loadDestinationSecret(row.id);
    if (!destination.enabled || !destination.configured) return jsonError("Configure and enable this destination first.", 409);
    const valid = validateDestinationWebhook(body.channel, destination.webhookUrl);
    if (!valid.ok) return jsonError("Notification destination is not ready.", 409);
    const event = syntheticTestEvent(body.category, body.environment);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(valid.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(providerPayload(body.channel, renderBusinessMessage(event))), signal: controller.signal });
    } finally { clearTimeout(timer); }
    const now = new Date().toISOString();
    const patch = response.ok
      ? { last_test_at: now, last_success_at: now, last_error_summary: null, updated_at: now }
      : { last_test_at: now, last_error_at: now, last_error_summary: `http_status_${response.status}`, updated_at: now };
    await supabase.from("notification_destination_settings").update(patch).eq("id", row.id);
    if (!response.ok) return jsonError("Test notification was not accepted.", 502, { reason: `http_status_${response.status}` });
    return jsonOk({ category: body.category, environment: body.environment, channel: body.channel, status: "success", business_event_created: false });
  } catch {
    return jsonError("Test notification failed.", 502, { reason: "webhook_request_failed" });
  }
}
