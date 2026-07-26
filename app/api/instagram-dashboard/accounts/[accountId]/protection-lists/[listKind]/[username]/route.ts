import {
  getInstagramAdminUserContext,
  requireInstagramAdmin,
} from "@/app/api/instagram-dashboard/_utils";
import { handleProtectionListDelete, validateProtectionListRoute } from "@/lib/instagram-dashboard/account-protection-list-routes";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ accountId: string; listKind: string; username: string }> },
) {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;
  const params = await context.params;
  const route = validateProtectionListRoute(params.accountId, params.listKind);
  if (!route.ok) return route.response;
  const actor = await getInstagramAdminUserContext();
  return handleProtectionListDelete(
    request,
    { ...route, actorAuthUserId: actor?.userId ?? null, sourceSurface: "admin_dashboard" },
    params.username,
  );
}
