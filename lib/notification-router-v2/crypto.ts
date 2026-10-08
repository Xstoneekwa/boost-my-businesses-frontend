import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const CURRENT_NOTIFICATION_KEY_VERSION = "notification_v2";
export const LEGACY_INCIDENT_KEY_VERSION = "incident_v1";

function dedicatedSecret(keyVersion: string): string {
  const raw = keyVersion === LEGACY_INCIDENT_KEY_VERSION
    ? process.env.INCIDENT_NOTIFICATION_WEBHOOK_ENCRYPTION_KEY
    : process.env.NOTIFICATION_ROUTER_ENCRYPTION_KEY_V2;
  const secret = String(raw || "").trim();
  if (!secret) {
    throw new Error(`notification_encryption_key_missing:${keyVersion}`);
  }
  return secret;
}

function key(keyVersion: string) {
  return createHash("sha256").update(dedicatedSecret(keyVersion)).digest();
}

export function encryptNotificationWebhook(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(CURRENT_NOTIFICATION_KEY_VERSION), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64"),
    keyVersion: CURRENT_NOTIFICATION_KEY_VERSION,
  };
}

export function decryptNotificationWebhook(ciphertext: string, keyVersion: string) {
  const raw = Buffer.from(String(ciphertext || ""), "base64");
  if (raw.length < 29) throw new Error("notification_webhook_ciphertext_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key(keyVersion), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
