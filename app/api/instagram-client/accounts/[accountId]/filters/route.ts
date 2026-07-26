import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

async function authorizeAccountRoute(accountId: string) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return { error: NextResponse.json({ ok: false, error: session.error }, { status: session.status }) };
  }
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) {
    return { error: NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 }) };
  }
  const ownership = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!ownership.ok) {
    return { error: NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status }) };
  }
  return { accountId: normalizedAccountId };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  return NextResponse.json({
    ok: false,
    error: "legacy_protection_lists_retired",
    canonical: `/api/instagram-client/accounts/${encodeURIComponent(auth.accountId)}/protection-lists/{listKind}`,
  }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  return NextResponse.json({
    ok: false,
    error: "legacy_protection_lists_retired",
    canonical: `/api/instagram-client/accounts/${encodeURIComponent(auth.accountId)}/protection-lists/{listKind}`,
  }, { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
