import {
  getInstagramAdminUserContext,
  requireInstagramAdmin,
} from "@/app/api/instagram-dashboard/_utils";
import {
  handleProtectionListGet,
  handleProtectionListPatch,
  handleProtectionListPut,
  validateProtectionListRoute,
} from "@/lib/instagram-dashboard/account-protection-list-routes";

export const dynamic = "force-dynamic";

async function authorize(accountId: string, listKind: string) {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return { ok: false as const, response: unauthorized };
  const route = validateProtectionListRoute(accountId, listKind);
  if (!route.ok) return { ok: false as const, response: route.response };
  const actor = await getInstagramAdminUserContext();
  return {
    ok: true as const,
    route: { ...route, actorAuthUserId: actor?.userId ?? null, sourceSurface: "admin_dashboard" as const },
  };
}

export async function GET(_request: Request, context: { params: Promise<{ accountId: string; listKind: string }> }) {
  const params = await context.params;
  const auth = await authorize(params.accountId, params.listKind);
  return auth.ok ? handleProtectionListGet(auth.route) : auth.response;
}

export async function PUT(request: Request, context: { params: Promise<{ accountId: string; listKind: string }> }) {
  const params = await context.params;
  const auth = await authorize(params.accountId, params.listKind);
  return auth.ok ? handleProtectionListPut(request, auth.route) : auth.response;
}

export async function PATCH(request: Request, context: { params: Promise<{ accountId: string; listKind: string }> }) {
  const params = await context.params;
  const auth = await authorize(params.accountId, params.listKind);
  return auth.ok ? handleProtectionListPatch(request, auth.route) : auth.response;
}
