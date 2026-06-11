import { getProfileDetailsData } from "@/lib/instagram-dashboard/profile-details-data";
import { jsonError, jsonOk, requireInstagramAdmin } from "../../../_utils";
import { verifyCompassRelayKey } from "../../../compass/relay-auth";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return jsonError("Profile details relay authentication failed.", 403, { reason: relayAuth.reason });
  }
  return requireInstagramAdmin();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request);
    if (unauthorizedResponse) return unauthorizedResponse;

    const { accountId } = await context.params;
    const normalizedAccountId = accountId?.trim() ?? "";
    if (!normalizedAccountId) return jsonError("Missing account id.", 400);

    const details = await getProfileDetailsData(normalizedAccountId);
    if (!details.ok) return jsonError(details.error, 404, { accountId: normalizedAccountId });

    return jsonOk({
      generated_at: new Date().toISOString(),
      ...details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load profile details.";
    return jsonError(message, 500);
  }
}
