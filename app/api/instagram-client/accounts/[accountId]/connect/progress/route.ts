import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { loadClientConnectProgress } from "@/lib/instagram-client/load-client-connect-progress";
import { readString } from "@/app/api/instagram-dashboard/_utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
    }

    const { accountId } = await context.params;
    const normalizedAccountId = readString(accountId);
    if (!normalizedAccountId) {
      return NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 });
    }

    const authorized = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
    if (!authorized.ok) {
      return NextResponse.json({ ok: false, error: authorized.error }, { status: authorized.status });
    }

    const url = new URL(request.url);
    const requestId = readString(url.searchParams.get("request_id"));
    const lang = url.searchParams.get("lang") === "en" ? "en" : "fr";
    const snapshot = await loadClientConnectProgress({
      accountId: normalizedAccountId,
      requestId: requestId || undefined,
      lang,
    });

    return NextResponse.json({ ok: true, data: snapshot });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not load connection progress." }, { status: 503 });
  }
}
