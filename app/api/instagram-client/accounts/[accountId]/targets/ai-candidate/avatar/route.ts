import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { resolveTargetAvatarUpstream } from "@/lib/instagram-client/target-avatar-proxy-server";
import { normalizeInstagramPublicUsername } from "@/lib/instagram-public-profile-lookup";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
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
  if (!ownership.ok) return NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status });

  const username = normalizeInstagramPublicUsername(new URL(request.url).searchParams.get("username") ?? "");
  if (!username) {
    return NextResponse.json({ ok: false, error: "Missing username." }, { status: 400 });
  }

  const upstream = await resolveTargetAvatarUpstream({ username });
  if (!upstream?.body) {
    return NextResponse.json({ ok: false, error: "avatar_unavailable" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
