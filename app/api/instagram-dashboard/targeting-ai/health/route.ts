import { NextResponse } from "next/server";
import { requireInstagramAdmin } from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";
import { buildTargetingAiPublicConfig } from "@/lib/instagram-client/targeting-ai-settings";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return NextResponse.json(
      {
        ok: false,
        reason: relayAuth.reason,
        openai_key_configured: false,
        searchapi_key_configured: false,
      },
      { status: relayAuth.reason === "relay_auth_required" ? 401 : 403 },
    );
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;

  const config = buildTargetingAiPublicConfig();
  if (!config.enabled) {
    return NextResponse.json({
      ...config,
      ok: false,
      service: "targeting_ai_relay",
      reason: "target_ai_disabled",
    }, { status: 503 });
  }

  if (!config.openai_key_configured) {
    return NextResponse.json({
      ...config,
      ok: false,
      service: "targeting_ai_relay",
      reason: "openai_key_missing",
    }, { status: 503 });
  }

  if (!config.searchapi_key_configured) {
    return NextResponse.json({
      ...config,
      ok: false,
      service: "targeting_ai_relay",
      reason: "searchapi_key_missing",
    }, { status: 503 });
  }

  return NextResponse.json({
    ...config,
    ok: true,
    service: "targeting_ai_relay",
  });
}
