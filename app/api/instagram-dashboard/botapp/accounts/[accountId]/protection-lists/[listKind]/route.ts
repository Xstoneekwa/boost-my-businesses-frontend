import { verifyCompassRelayKey } from "@/app/api/instagram-dashboard/compass/relay-auth";
import {
  handleProtectionListGet,
  handleProtectionListPatch,
  handleProtectionListPut,
  validateProtectionListRoute,
} from "@/lib/instagram-dashboard/account-protection-list-routes";

export const dynamic = "force-dynamic";

function authorize(request: Request, accountId: string, listKind: string) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (!relayAuth.ok) {
    return { ok: false as const, response: Response.json({ ok: false, error: "botapp_relay_auth_failed" }, { status: 403 }) };
  }
  const route = validateProtectionListRoute(accountId, listKind);
  if (!route.ok) return route;
  return {
    ok: true as const,
    route: { ...route, actorAuthUserId: null, sourceSurface: "botapp" as const },
  };
}

type Context = { params: Promise<{ accountId: string; listKind: string }> };

export async function GET(request: Request, context: Context) {
  const params = await context.params;
  const auth = authorize(request, params.accountId, params.listKind);
  return auth.ok ? handleProtectionListGet(auth.route) : auth.response;
}

export async function PUT(request: Request, context: Context) {
  const params = await context.params;
  const auth = authorize(request, params.accountId, params.listKind);
  return auth.ok ? handleProtectionListPut(request, auth.route) : auth.response;
}

export async function PATCH(request: Request, context: Context) {
  const params = await context.params;
  const auth = authorize(request, params.accountId, params.listKind);
  return auth.ok ? handleProtectionListPatch(request, auth.route) : auth.response;
}
