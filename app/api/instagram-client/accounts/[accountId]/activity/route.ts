import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, readString, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { loadClientAccountActivity } from "@/lib/instagram-client/client-activity-log";

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
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  const url = new URL(request.url);
  const langParam = readString(url.searchParams.get("lang"), "fr").toLowerCase();
  const periodParam = readString(url.searchParams.get("period"), "30d").toLowerCase();
  const period = periodParam === "7d" || periodParam === "90d" ? periodParam : "30d";

  const page = await loadClientAccountActivity(auth.accountId, {
    search: readString(url.searchParams.get("search"), "") || readString(url.searchParams.get("q"), ""),
    period,
    action: readString(url.searchParams.get("action"), ""),
    result: readString(url.searchParams.get("result"), ""),
    cursor: readString(url.searchParams.get("cursor"), ""),
    limit: Number(url.searchParams.get("limit") ?? "50"),
    lang: langParam === "en" ? "en" : "fr",
  });

  if (!page) {
    return NextResponse.json({ ok: false, error: "Activity is unavailable for this account." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      items: page.items,
      nextCursor: page.nextCursor,
    },
  });
}
