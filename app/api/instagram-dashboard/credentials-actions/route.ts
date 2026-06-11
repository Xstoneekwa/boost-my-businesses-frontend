import { getCredentialsActionsData } from "@/app/instagram-dashboard/credentials-actions-data";
import { jsonError, jsonOk, requireInstagramAdmin } from "../_utils";
import { verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Credentials Actions relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    return jsonOk({
      generated_at: new Date().toISOString(),
      ...(await getCredentialsActionsData()),
    });
  } catch {
    return jsonError("Could not load BotApp credentials actions.", 500);
  }
}
