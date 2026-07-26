import { verifyCompassRelayKey } from "@/app/api/instagram-dashboard/compass/relay-auth";
import {
  handleProtectionListDelete,
  validateProtectionListRoute,
} from "@/lib/instagram-dashboard/account-protection-list-routes";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ accountId: string; listKind: string; username: string }> };

export async function DELETE(request: Request, context: Context) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (!relayAuth.ok) {
    return Response.json({ ok: false, error: "botapp_relay_auth_failed" }, { status: 403 });
  }
  const params = await context.params;
  const route = validateProtectionListRoute(params.accountId, params.listKind);
  if (!route.ok) return route.response;
  return handleProtectionListDelete(request, {
    ...route,
    actorAuthUserId: null,
    sourceSurface: "botapp",
  }, params.username);
}
