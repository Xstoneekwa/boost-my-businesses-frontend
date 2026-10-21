import { createHash } from "node:crypto";
import { createDecipheriv } from "node:crypto";
import { createSupabaseClient } from "../lib/supabase";
import { encryptNotificationWebhook } from "../lib/notification-router-v2/crypto";

function legacyKey() {
  const dedicated = String(process.env.INCIDENT_NOTIFICATION_WEBHOOK_ENCRYPTION_KEY || "").trim();
  if (dedicated) return createHash("sha256").update(dedicated).digest();
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRole) throw new Error("legacy_incident_notification_key_unavailable");
  return createHash("sha256").update(createHash("sha256").update(`local-incident-notif:${serviceRole}`).digest("hex")).digest();
}

function decryptLegacy(ciphertext: string) {
  const raw = Buffer.from(ciphertext, "base64");
  if (raw.length < 29) throw new Error("legacy_incident_ciphertext_invalid");
  const decipher = createDecipheriv("aes-256-gcm", legacyKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

async function main() {
  if (!String(process.env.NOTIFICATION_ROUTER_ENCRYPTION_KEY_V2 || "").trim()) {
    throw new Error("NOTIFICATION_ROUTER_ENCRYPTION_KEY_V2 is required");
  }
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from("incident_notification_channel_settings")
    .select("channel,webhook_ciphertext").in("channel", ["slack", "discord"]);
  if (error) throw new Error(`legacy_incident_settings_read_failed:${error.code || "unknown"}`);
  const ciphertexts: Record<string, string> = {};
  for (const row of data ?? []) {
    if (!row.webhook_ciphertext) continue;
    const channel = String(row.channel);
    if (!['slack', 'discord'].includes(channel)) continue;
    const plaintext = decryptLegacy(String(row.webhook_ciphertext));
    ciphertexts[channel] = encryptNotificationWebhook(plaintext).ciphertext;
  }
  const { data: rotated, error: rotateError } = await supabase.rpc("rotate_notification_incident_ciphertexts_v2", { p_ciphertexts: ciphertexts });
  if (rotateError) throw new Error(`incident_ciphertext_rotation_failed:${rotateError.code || "unknown"}`);
  process.stdout.write(JSON.stringify({ ok: true, rotated: Number(rotated?.rotated ?? 0), secrets_logged: false }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "incident_ciphertext_rotation_failed"}\n`);
  process.exitCode = 1;
});
