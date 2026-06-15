import { getClientAccountsOperationsData } from "@/app/instagram-dashboard/client-accounts-data";
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

    const clientAccounts = await getClientAccountsOperationsData();

    return jsonOk({
      generated_at: new Date().toISOString(),
      accounts: clientAccounts.items,
      summary: clientAccounts.summary,
      sourceStatus: clientAccounts.sourceStatus,
      sourceDetails: clientAccounts.sourceDetails,
      errors: clientAccounts.errors,
      source: "client_accounts_operations_projection",
    });
  } catch {
    return jsonError("Could not load BotApp client accounts.", 500);
  }
}
