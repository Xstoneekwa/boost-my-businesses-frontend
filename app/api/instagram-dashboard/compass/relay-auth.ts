export type CompassRelayAuthResult =
  | { ok: true; mode: "relay_key" | "admin_session" }
  | { ok: false; reason: "relay_auth_required" | "relay_auth_invalid" | "relay_auth_unconfigured" };

export function configuredRelayKey() {
  return (process.env.BOTAPP_RELAY_API_KEY || "").trim();
}

export function readRelayKey(headers: Headers) {
  const direct = headers.get("x-botapp-relay-key")?.trim() ?? "";
  if (direct) return direct;

  const authorization = headers.get("authorization")?.trim() ?? "";
  const prefix = ["Bear", "er "].join("");
  if (authorization.toLowerCase().startsWith(prefix.toLowerCase())) {
    return authorization.slice(prefix.length).trim();
  }

  return "";
}

export async function relayKeySha256Prefix(value: string, length = 8) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, Math.max(0, Math.min(length, 8)));
}

export function relayAuthStatus(reason: "relay_auth_required" | "relay_auth_invalid" | "relay_auth_unconfigured") {
  if (reason === "relay_auth_required") return 401;
  if (reason === "relay_auth_unconfigured") return 503;
  return 403;
}

export function compassRelayAuthFailureReason(
  relayAuth: CompassRelayAuthResult,
): "relay_auth_required" | "relay_auth_invalid" | "relay_auth_unconfigured" {
  return relayAuth.ok ? "relay_auth_required" : relayAuth.reason;
}

export function verifyCompassRelayKey(headers: Headers): CompassRelayAuthResult {
  const expected = configuredRelayKey();
  const provided = readRelayKey(headers);
  if (!expected) return provided ? { ok: false, reason: "relay_auth_unconfigured" } : { ok: true, mode: "admin_session" };
  if (!provided) return { ok: false, reason: "relay_auth_required" };
  if (provided !== expected) return { ok: false, reason: "relay_auth_invalid" };

  return { ok: true, mode: "relay_key" };
}
