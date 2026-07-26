import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { handleProtectionListDelete, validateProtectionListRoute } from "@/lib/instagram-dashboard/account-protection-list-routes";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ accountId: string; listKind: string; username: string }> },
) {
  const params = await context.params;
  const route = validateProtectionListRoute(params.accountId, params.listKind);
  if (!route.ok) return route.response;
  const session = await requireClientInstagramSession();
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  const ownership = await authorizeClientInstagramAccount(session.userId, route.accountId);
  if (!ownership.ok) return NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status });
  return handleProtectionListDelete(
    request,
    { ...route, actorAuthUserId: session.userId, sourceSurface: "client_dashboard" },
    params.username,
  );
}
