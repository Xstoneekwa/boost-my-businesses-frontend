import { getAutoRestartData } from "@/app/instagram-dashboard/auto-restart-data";
import { getActivityLogData } from "@/app/instagram-dashboard/activity-log-data";
import { getCredentialsActionsData } from "@/app/instagram-dashboard/credentials-actions-data";
import { getManageData } from "@/app/instagram-dashboard/manage-data";
import { getRadarData } from "@/app/instagram-dashboard/radar-data";
import { getDashboardDevices } from "../../devices/route";
import { jsonError, jsonOk, requireInstagramAdmin } from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type SectionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("BotApp relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

async function section<T>(loader: () => Promise<T>): Promise<SectionResult<T>> {
  try {
    return { ok: true, data: await loader() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Section unavailable." };
  }
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const [manage, credentials, radar, devices, activityLog, autoRestart] = await Promise.all([
      section(getManageData),
      section(getCredentialsActionsData),
      section(getRadarData),
      section(getDashboardDevices),
      section(getActivityLogData),
      section(getAutoRestartData),
    ]);

    return jsonOk({
      generated_at: new Date().toISOString(),
      manage,
      credentials,
      radar,
      devices,
      activity_log: activityLog,
      auto_restart: autoRestart,
      endpoint_statuses: {
        profiles: "connected",
        client_accounts: "connected",
        devices: devices.ok ? "connected" : "failing",
        credentials: credentials.ok ? "connected" : "failing",
        activity_log: activityLog.ok ? "connected" : "failing",
        compass: "relay_test_required",
        auto_restart: autoRestart.ok ? "connected" : "failing",
      },
    });
  } catch {
    return jsonError("Could not load BotApp overview.", 500);
  }
}
