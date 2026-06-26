import { jsonError, jsonOk, readString } from "@/app/api/instagram-dashboard/_utils";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { cancelClientConnectAttempt } from "@/lib/instagram-client/cancel-client-connect-attempt";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);

  const { accountId } = await context.params;
  const normalizedAccountId = readString(accountId);
  if (!normalizedAccountId) return jsonError("Missing account id.", 400);

  const authorized = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!authorized.ok) return jsonError(authorized.error, authorized.status);

  try {
    const result = await cancelClientConnectAttempt({
      accountId: normalizedAccountId,
      reason: "client_connect_cancel_restart",
      actorUserId: session.userId,
    });
    return jsonOk(result);
  } catch {
    return jsonError("Could not cancel the connection attempt.", 503);
  }
}
