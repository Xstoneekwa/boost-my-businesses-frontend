export type CompassRelayAuthResult =
  | { ok: true; mode: "relay_key" | "admin_session" }
  | { ok: false; reason: "relay_auth_required" | "relay_auth_invalid" };

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

export function verifyCompassRelayKey(headers: Headers): CompassRelayAuthResult {
  const expected = configuredRelayKey();
  if (!expected) return { ok: true, mode: "admin_session" };

  const provided = readRelayKey(headers);
  if (!provided) return { ok: false, reason: "relay_auth_required" };
  if (provided !== expected) return { ok: false, reason: "relay_auth_invalid" };

  return { ok: true, mode: "relay_key" };
}
