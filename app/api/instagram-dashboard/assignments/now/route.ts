import { assignNowForAccount } from "@/lib/instagram-dashboard/assign-now";
import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  validateAccountId,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type AssignNowBody = {
  account_id?: unknown;
};

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { mode: "relay_key" as const, userId: null };
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    const response = jsonError("Assignment relay authentication failed.", 403, { reason: relayAuth.reason });
    return { mode: "unauthorized" as const, response };
  }
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return { mode: "unauthorized" as const, response: unauthorizedResponse };
  const adminContext = await getInstagramAdminUserContext();
  return { mode: "admin_session" as const, userId: adminContext?.userId ?? null };
}

export async function POST(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const body = await readJsonBody<AssignNowBody>(request);
    const accountId = readString(body?.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const result = await assignNowForAccount(createSupabaseClient(), accountId, auth.userId);
    return jsonOk({
      ...result,
      account_id: accountId,
      run_started: false,
      provisioning_started: false,
      login_started: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not assign account now.";
    return jsonError(sanitizeRunControlReason(message, "Could not assign account now."), 500);
  }
}
