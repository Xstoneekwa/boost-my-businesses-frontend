import {
  getIncidentNotificationSettingsPublic,
  patchIncidentNotificationSettings,
} from "@/lib/instagram-dashboard/incident-notification-settings";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
} from "../../../_utils";

export const dynamic = "force-dynamic";

type SettingsPatchBody = {
  slack?: {
    enabled?: unknown;
    webhook_url?: unknown;
    clear_webhook?: unknown;
  };
  discord?: {
    enabled?: unknown;
    webhook_url?: unknown;
    clear_webhook?: unknown;
  };
};

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Incident notification settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const data = await getIncidentNotificationSettingsPublic();
    if (!data.ok) {
      return jsonError(data.error || "Could not load notification settings.", 500);
    }
    return jsonOk({ channels: data.channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load notification settings.";
    return jsonError(message, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Incident notification settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = (await readJsonBody<SettingsPatchBody>(request)) ?? {};
    let actorId: string | null = null;
    try {
      actorId = (await getInstagramAdminUserContext())?.userId ?? null;
    } catch {
      actorId = null;
    }

    const result = await patchIncidentNotificationSettings({
      slack: body.slack ? {
        enabled: body.slack.enabled === undefined ? undefined : readBoolean(body.slack.enabled, false),
        webhook_url: readString(body.slack.webhook_url).trim() || undefined,
        clear_webhook: readBoolean(body.slack.clear_webhook, false),
      } : undefined,
      discord: body.discord ? {
        enabled: body.discord.enabled === undefined ? undefined : readBoolean(body.discord.enabled, false),
        webhook_url: readString(body.discord.webhook_url).trim() || undefined,
        clear_webhook: readBoolean(body.discord.clear_webhook, false),
      } : undefined,
      actorId,
      source: "admin_dashboard",
    });

    if (!result.ok) {
      return jsonError("Notification settings update failed.", 400, {
        reason: result.reason,
        channel: result.channel,
      });
    }

    return jsonOk({ channels: result.channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update notification settings.";
    return jsonError(message, 500);
  }
}
