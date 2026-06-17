import { NextResponse } from "next/server";
import { requireRelayOrAdmin } from "../../_utils";
import {
  loadTargetingAiConfigSnapshot,
  serializeTargetingAiPublicConfig,
} from "@/lib/instagram-client/targeting-ai-config-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Targeting AI health");
  if (unauthorizedResponse) return unauthorizedResponse;

  const snapshot = await loadTargetingAiConfigSnapshot();
  const config = serializeTargetingAiPublicConfig(snapshot);

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
