import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { loadClientFollowerGrowthSeries } from "@/lib/instagram-client/load-client-follower-growth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });

  const { accountId } = await context.params;
  const normalizedAccountId = accountId?.trim() ?? "";
  if (!normalizedAccountId) {
    return NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 });
  }

  const ownership = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!ownership.ok) {
    return NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status });
  }

  const growth = await loadClientFollowerGrowthSeries(normalizedAccountId);
  if (!growth) {
    return NextResponse.json({ ok: false, error: "Follower growth unavailable." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: growth });
}
