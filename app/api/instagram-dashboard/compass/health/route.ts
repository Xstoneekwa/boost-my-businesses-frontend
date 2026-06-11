import { NextResponse } from "next/server";
import { requireInstagramAdmin } from "../../_utils";
import { verifyCompassRelayKey } from "../relay-auth";

export const dynamic = "force-dynamic";

const defaultProvider = "openai";
const defaultModel = "gpt-5.5";

function aiEnabled() {
  return process.env.COMPASS_AI_ENABLED === "true" && (process.env.COMPASS_AI_PROVIDER || defaultProvider) === "openai";
}

function aiModel() {
  return (process.env.COMPASS_AI_MODEL || defaultModel).trim() || defaultModel;
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return NextResponse.json({ ok: false, reason: relayAuth.reason, provider_key_configured: false }, { status: relayAuth.reason === "relay_auth_required" ? 401 : 403 });
  }
  return requireInstagramAdmin();
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request);
  if (unauthorizedResponse) return unauthorizedResponse;

  const providerKeyConfigured = Boolean(process.env.OPENAI_API_KEY);
  if (!aiEnabled()) {
    return NextResponse.json({
      ok: false,
      reason: "compass_ai_disabled",
      compass_ai_enabled: false,
      provider: defaultProvider,
      model: aiModel(),
      provider_key_configured: providerKeyConfigured,
      schema_version: "v1",
    }, { status: 503 });
  }

  if (!providerKeyConfigured) {
    return NextResponse.json({
      ok: false,
      reason: "provider_key_missing",
      compass_ai_enabled: true,
      provider: defaultProvider,
      model: aiModel(),
      provider_key_configured: false,
      schema_version: "v1",
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    compass_ai_enabled: true,
    provider: defaultProvider,
    model: aiModel(),
    provider_key_configured: true,
    schema_version: "v1",
  });
}
