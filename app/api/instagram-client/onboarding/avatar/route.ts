import { NextResponse } from "next/server";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { loadClientOnboardingAvatarSource } from "@/lib/instagram-client/client-account-onboarding";
import { resolveTargetAvatarUpstream } from "@/lib/instagram-client/target-avatar-proxy-server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return new NextResponse(null, { status: session.status });

  const sessionId = new URL(request.url).searchParams.get("session_id")?.trim() ?? "";
  if (!UUID_PATTERN.test(sessionId)) return new NextResponse(null, { status: 400 });

  const source = await loadClientOnboardingAvatarSource(session.clientId, sessionId);
  if (!source) return new NextResponse(null, { status: 404 });

  const upstream = await resolveTargetAvatarUpstream({
    username: source.username,
    storedAvatarUrl: source.avatarUrl,
    allowProviderRefresh: false,
  });
  if (!upstream?.body) return new NextResponse(null, { status: 404 });

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.contentType,
      "Content-Length": String(upstream.body.byteLength),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
