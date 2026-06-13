import { getCredentialsActionsData } from "@/app/instagram-dashboard/credentials-actions-data";
import { getManageData } from "@/app/instagram-dashboard/manage-data";
import { jsonError, jsonOk, requireInstagramAdmin } from "../_utils";
import { verifyCompassRelayKey } from "../compass/relay-auth";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Client Accounts relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const [manage, credentials] = await Promise.all([
      getManageData(),
      getCredentialsActionsData().catch((error) => ({ error: error instanceof Error ? error.message : "Credentials unavailable." })),
    ]);

    return jsonOk({
      generated_at: new Date().toISOString(),
      accounts: manage.allAccounts,
      activeAccounts: manage.activeAccounts,
      archivedAccounts: manage.archivedAccounts,
      trashedAccounts: manage.trashedAccounts,
      summary: manage.summary,
      credentials,
      errors: manage.errors,
      source: "manage_overview",
    });
  } catch {
    return jsonError("Could not load BotApp client accounts.", 500);
  }
}
