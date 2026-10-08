import { listDestinationSettings, updateDestinationSetting } from "@/lib/notification-router-v2/settings";
import { isNotificationCategory, isNotificationChannel, isNotificationEnvironment } from "@/lib/notification-router-v2/contracts";
import { jsonError, jsonOk, readJsonBody, requireRelayOrAdmin } from "../../../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Notification Router V2 settings");
  if (unauthorized) return unauthorized;
  try { return jsonOk({ destinations: await listDestinationSettings() }); }
  catch { return jsonError("Notification settings are unavailable.", 503); }
}

export async function PATCH(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Notification Router V2 settings");
  if (unauthorized) return unauthorized;
  const body = await readJsonBody<Record<string, unknown>>(request) ?? {};
  if (!isNotificationCategory(body.category) || !isNotificationEnvironment(body.environment) || !isNotificationChannel(body.channel)) {
    return jsonError("Invalid notification destination.", 400);
  }
  try {
    const destination = await updateDestinationSetting({
      category: body.category, environment: body.environment, channel: body.channel,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      webhookUrl: typeof body.webhook_url === "string" && body.webhook_url.trim() ? body.webhook_url.trim() : undefined,
      clearWebhook: body.clear_webhook === true,
      destinationLabel: typeof body.destination_label === "string" || body.destination_label === null ? body.destination_label : undefined,
      externalDestinationHint: typeof body.external_destination_hint === "string" || body.external_destination_hint === null ? body.external_destination_hint : undefined,
    });
    return jsonOk({ destination });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "notification_settings_write_failed";
    return jsonError("Notification destination update failed.", 400, { reason });
  }
}
