import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import {
  handleProtectionListGet,
  handleProtectionListPatch,
  handleProtectionListPut,
  validateProtectionListRoute,
} from "@/lib/instagram-dashboard/account-protection-list-routes";

export const dynamic = "force-dynamic";

async function authorize(accountId: string, listKind: string) {
  const route = validateProtectionListRoute(accountId, listKind);
  if (!route.ok) return { ok: false as const, response: route.response };
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: session.error }, { status: session.status }) };
  }
  const ownership = await authorizeClientInstagramAccount(session.userId, route.accountId);
  if (!ownership.ok) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status }) };
  }
  return {
    ok: true as const,
    route: { ...route, actorAuthUserId: session.userId, sourceSurface: "client_dashboard" as const },
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
