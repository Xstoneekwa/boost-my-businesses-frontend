import { getActivityLogData } from "@/app/instagram-dashboard/activity-log-data";
import { jsonError, jsonOk, requireInstagramAdmin } from "../_utils";
import { verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Activity Log relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    return jsonOk({
      generated_at: new Date().toISOString(),
      ...(await getActivityLogData()),
    });
  } catch {
    return jsonError("Could not load BotApp activity log.", 500);
  }
}
