import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readString } from "./guards.ts";

export type ConnectOperationTokenPayload = {
  v: 1;
  action: "client_connect_operation";
  account_id: string;
  actor_user_id: string;
  connect_attempt_id: string;
  request_id: string;
  exp: number;
  nonce: string;
};

const CONNECT_OPERATION_TTL_MS = 2 * 60 * 60 * 1000;
const CONNECT_OPERATION_CIPHER = "aes-256-gcm";
const CONNECT_OPERATION_IV_BYTES = 12;
const CONNECT_OPERATION_KEY_SALT = "client-connect-operation-v1";

function connectOperationSecret() {
  return process.env.INSTAGRAM_CLIENT_INTENT_SECRET?.trim()
    || process.env.INSTAGRAM_COMPASS_RELAY_KEY?.trim()
    || "";
}

function deriveConnectOperationKey(secret: string) {
  return scryptSync(secret, CONNECT_OPERATION_KEY_SALT, 32);
}

function parsePayload(raw: unknown): ConnectOperationTokenPayload | null {
  const parsed = raw as ConnectOperationTokenPayload;
  if (parsed?.v !== 1 || parsed.action !== "client_connect_operation") return null;
  if (!readString(parsed.account_id) || !readString(parsed.actor_user_id)) return null;
  if (!readString(parsed.connect_attempt_id)) return null;
  if (!Number.isFinite(parsed.exp) || !readString(parsed.nonce)) return null;
  return parsed;
}

function encryptPayload(payload: ConnectOperationTokenPayload, secret: string) {
  const key = deriveConnectOperationKey(secret);
  const iv = randomBytes(CONNECT_OPERATION_IV_BYTES);
  const cipher = createCipheriv(CONNECT_OPERATION_CIPHER, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

function decryptPayload(token: string, secret: string): ConnectOperationTokenPayload | null {
  const parts = readString(token).split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const key = deriveConnectOperationKey(secret);
    const decipher = createDecipheriv(CONNECT_OPERATION_CIPHER, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return parsePayload(JSON.parse(plaintext.toString("utf8")));
  } catch {
    return null;
  }
}

export function createConnectOperationToken(input: {
  accountId: string;
  actorUserId: string;
  connectAttemptId: string;
  requestId?: string | null;
  now?: Date;
}) {
  const secret = connectOperationSecret();
  const accountId = readString(input.accountId);
  const actorUserId = readString(input.actorUserId);
  const connectAttemptId = readString(input.connectAttemptId);
  if (!secret || !accountId || !actorUserId || !connectAttemptId) return null;

  const now = input.now ?? new Date();
  const payload: ConnectOperationTokenPayload = {
    v: 1,
    action: "client_connect_operation",
    account_id: accountId,
    actor_user_id: actorUserId,
    connect_attempt_id: connectAttemptId,
    request_id: readString(input.requestId, "") || "",
    exp: now.getTime() + CONNECT_OPERATION_TTL_MS,
    nonce: randomBytes(16).toString("hex"),
  };

  return {
    connect_operation_token: encryptPayload(payload, secret),
    expires_at: new Date(payload.exp).toISOString(),
  };
}

export function verifyConnectOperationToken(
  token: string,
  input: { accountId: string; actorUserId: string },
  now = new Date(),
) {
  const secret = connectOperationSecret();
  if (!secret) return { ok: false as const, reason: "connect_operation_secret_unconfigured" };

  const payload = decryptPayload(readString(token), secret);
  if (!payload) return { ok: false as const, reason: "connect_operation_invalid_payload" };
  if (payload.exp <= now.getTime()) return { ok: false as const, reason: "connect_operation_expired" };
  if (payload.account_id !== readString(input.accountId)) {
    return { ok: false as const, reason: "connect_operation_account_mismatch" };
  }
  if (payload.actor_user_id !== readString(input.actorUserId)) {
    return { ok: false as const, reason: "connect_operation_actor_mismatch" };
  }

  return { ok: true as const, payload };
}

export function decodeConnectOperationTokenForTests(token: string) {
  const secret = connectOperationSecret();
  if (!secret) return null;
  return decryptPayload(readString(token), secret);
}
