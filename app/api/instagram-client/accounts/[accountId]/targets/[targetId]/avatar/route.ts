import { NextResponse } from "next/server";
import { safeExternalImageUrl } from "@/lib/instagram-dashboard/safe-external-url";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string; targetId: string }> },
) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return NextResponse.json({ ok: false, error: session.error }, { status: session.status });

  const { accountId, targetId } = await context.params;
  const normalizedAccountId = accountId?.trim() ?? "";
  const normalizedTargetId = targetId?.trim() ?? "";
  if (!normalizedAccountId || !normalizedTargetId) {
    return NextResponse.json({ ok: false, error: "Missing account or target id." }, { status: 400 });
  }

  const ownership = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!ownership.ok) return NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status });

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_targets")
    .select("id,account_id,avatar_url")
    .eq("id", normalizedTargetId)
    .eq("account_id", normalizedAccountId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: "avatar_unavailable" }, { status: 502 });
  const avatarUrl = safeExternalImageUrl(readString(data?.avatar_url, ""));
  if (!avatarUrl) return NextResponse.json({ ok: false, error: "avatar_not_found" }, { status: 404 });

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
