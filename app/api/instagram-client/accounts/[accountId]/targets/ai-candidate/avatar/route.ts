import { NextResponse } from "next/server";
import { safeExternalImageUrl } from "@/lib/instagram-dashboard/safe-external-url";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { lookupInstagramPublicProfile, normalizeInstagramPublicUsername } from "@/lib/instagram-public-profile-lookup";

export const dynamic = "force-dynamic";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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

  const lookup = await lookupInstagramPublicProfile(username);
  const avatarUrl = safeExternalImageUrl(lookup.avatar_url ?? "");
  if (lookup.status !== "found" || !avatarUrl) {
    return NextResponse.json({ ok: false, error: "avatar_not_found" }, { status: 404 });
  }

  try {
    const upstream = await fetch(avatarUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    });
    if (!upstream.ok) return NextResponse.json({ ok: false, error: "avatar_unavailable" }, { status: 502 });

    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!allowedImageTypes.has(contentType)) {
      return NextResponse.json({ ok: false, error: "avatar_unavailable" }, { status: 502 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=900",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "avatar_unavailable" }, { status: 502 });
  }
}
