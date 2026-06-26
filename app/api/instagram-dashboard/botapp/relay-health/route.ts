import { NextResponse } from "next/server";
import { jsonOk } from "../../_utils";
import {
  compassRelayAuthFailureReason,
  configuredRelayKey,
  readRelayKey,
  relayAuthStatus,
  relayKeySha256Prefix,
  verifyCompassRelayKey,
} from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

const BOTAPP_ROUTES = {
  devices: "/api/instagram-dashboard/devices",
  schedule_slots: "/api/instagram-dashboard/accounts/schedule-slots",
  verify_username: "/api/instagram-dashboard/profiles/verify-username",
  accounts_create: "/api/instagram-dashboard/accounts/create",
  settings_schedule: "/api/instagram-dashboard/settings/schedule",
  profiles: "/api/instagram-dashboard/profiles",
  targets: "/api/instagram-dashboard/targets",
  runs_start: "/api/instagram-dashboard/runs/start",
  runs_progress: "/api/instagram-dashboard/runs/progress",
  open_device_view: "/api/instagram-dashboard/botapp/open-device-view",
} as const;

function routeStatus(authenticated: boolean) {
  return Object.fromEntries(Object.keys(BOTAPP_ROUTES).map((key) => [key, authenticated ? "ok" : "blocked"]));
}

export async function GET(request: Request) {
  const expected = configuredRelayKey();
  const provided = readRelayKey(request.headers);
  const relayAuth = verifyCompassRelayKey(request.headers);
  const backendConfigured = Boolean(expected);
  const relayAuthenticated = relayAuth.ok && relayAuth.mode === "relay_key";
  const serverTime = new Date().toISOString();

  const diagnostics = {
    ok: relayAuthenticated,
    relay_authenticated: relayAuthenticated,
    backend_configured: backendConfigured,
    source: relayAuthenticated ? "botapp_relay" : "botapp_relay_check",
    server_time: serverTime,
    reason: relayAuth.ok ? null : relayAuth.reason,
    backend_key: {
      present: backendConfigured,
      length: expected.length,
      sha256_prefix: expected ? await relayKeySha256Prefix(expected) : null,
      environment_scope: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    },
    provided_key: {
      present: Boolean(provided),
      length: provided.length,
      sha256_prefix: provided ? await relayKeySha256Prefix(provided) : null,
    },
    routes: routeStatus(relayAuthenticated),
    route_paths: BOTAPP_ROUTES,
  };

  if (relayAuth.ok) {
    return jsonOk(diagnostics);
  }

  return NextResponse.json(
    { ok: false, error: "BotApp relay authentication failed.", data: diagnostics, reason: compassRelayAuthFailureReason(relayAuth) },
    { status: relayAuthStatus(compassRelayAuthFailureReason(relayAuth)) },
  );
}
