import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { resolveTargetAvatarUpstream } from "@/lib/instagram-client/target-avatar-proxy-server";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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
    .select("id,account_id,normalized_username,target_username,avatar_url")
    .eq("id", normalizedTargetId)
    .eq("account_id", normalizedAccountId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: "avatar_unavailable" }, { status: 502 });
  if (!data) return NextResponse.json({ ok: false, error: "avatar_not_found" }, { status: 404 });

  const username = readString(data.normalized_username, readString(data.target_username, ""));
  const storedAvatarUrl = readString(data.avatar_url, "") || null;
  if (!username) return NextResponse.json({ ok: false, error: "avatar_not_found" }, { status: 404 });

  const upstream = await resolveTargetAvatarUpstream({ username, storedAvatarUrl });
  if (!upstream?.body) {
    return new NextResponse(null, { status: 404 });
  }

  if (upstream.refreshedFromProvider) {
    void supabase
      .from("ig_targets")
      .update({ avatar_url: upstream.resolvedAvatarUrl, updated_at: new Date().toISOString() })
      .eq("id", normalizedTargetId)
      .eq("account_id", normalizedAccountId);
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.contentType,
      "Cache-Control": "private, max-age=900",
    },
  });
}
