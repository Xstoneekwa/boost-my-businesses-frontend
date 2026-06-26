import { NextResponse } from "next/server";
import { loadClientDmTemplatesProjection } from "@/lib/instagram-client/client-dm-templates";
import { sanitizeClientApiError } from "@/lib/instagram-client/client-account-canonical";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

const LOAD_ERROR_FR = "Impossible de charger les modèles DM.";
const LOAD_ERROR_EN = "Could not load DM templates.";

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

  try {
    const data = await loadClientDmTemplatesProjection(auth.accountId);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : LOAD_ERROR_EN;
    return NextResponse.json({
      ok: false,
      error: sanitizeClientApiError(message, LOAD_ERROR_EN),
    }, { status: 500 });
  }
}
