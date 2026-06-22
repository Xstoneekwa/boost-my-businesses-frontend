import { createHmac, timingSafeEqual } from "node:crypto";
import { configuredRelayKey } from "../../app/api/instagram-dashboard/compass/relay-auth.ts";
import { readString } from "./guards.ts";

export type OpenDeviceViewIntent = {
  v: 1;
  action: "open_device_view";
  account_id: string;
  actor_user_id: string;
  exp: number;
  nonce: string;
};

const INTENT_TTL_MS = 5 * 60 * 1000;

function intentSecret() {
  return configuredRelayKey() || process.env.INSTAGRAM_CLIENT_INTENT_SECRET?.trim() || "";
}

function encodePayload(payload: OpenDeviceViewIntent) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encoded: string): OpenDeviceViewIntent | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OpenDeviceViewIntent;
    if (parsed?.v !== 1 || parsed.action !== "open_device_view") return null;
    if (!readString(parsed.account_id) || !readString(parsed.actor_user_id)) return null;
    if (!Number.isFinite(parsed.exp) || !readString(parsed.nonce)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createOpenDeviceViewIntent(input: {
  accountId: string;
  actorUserId: string;
  now?: Date;
}) {
  const secret = intentSecret();
  if (!secret) return null;

  const now = input.now ?? new Date();
  const payload: OpenDeviceViewIntent = {
    v: 1,
    action: "open_device_view",
    account_id: readString(input.accountId),
    actor_user_id: readString(input.actorUserId),
    exp: now.getTime() + INTENT_TTL_MS,
    nonce: createHmac("sha256", secret).update(`${input.accountId}:${now.getTime()}:${Math.random()}`).digest("hex").slice(0, 16),
  };
  const encoded = encodePayload(payload);
  const signature = sign(encoded, secret);
  return {
    intent_token: `${encoded}.${signature}`,
    expires_at: new Date(payload.exp).toISOString(),
    open_url: `botapp://open-device-view?intent=${encodeURIComponent(`${encoded}.${signature}`)}`,
  };
}

export function verifyOpenDeviceViewIntent(token: string, now = new Date()) {
  const secret = intentSecret();
  if (!secret) return { ok: false as const, reason: "intent_secret_unconfigured" };

  const [encoded, signature] = readString(token).split(".");
  if (!encoded || !signature) return { ok: false as const, reason: "intent_malformed" };

  const expected = sign(encoded, secret);
  const provided = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    return { ok: false as const, reason: "intent_invalid_signature" };
  }

  const payload = decodePayload(encoded);
  if (!payload) return { ok: false as const, reason: "intent_invalid_payload" };
  if (payload.exp <= now.getTime()) return { ok: false as const, reason: "intent_expired" };

  return { ok: true as const, payload };
}

export function botappOpenDeviceProtocol() {
  return "botapp://open-device-view";
}
