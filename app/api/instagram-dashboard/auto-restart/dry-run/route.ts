import { getAutoRestartData } from "@/app/instagram-dashboard/auto-restart-data";
import { jsonError, jsonOk, requireInstagramAdmin } from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Auto Restart relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    return jsonOk({
      dry_run: true,
      mutation_executed: false,
      backend_status: "preview_only",
      overview: await getAutoRestartData(),
    });
  } catch {
    return jsonError("Could not run Auto Restart dry-run preview.", 500);
  }
}
