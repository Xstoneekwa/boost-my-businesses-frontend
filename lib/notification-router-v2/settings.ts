import { createSupabaseClient } from "@/lib/supabase";
import { CURRENT_NOTIFICATION_KEY_VERSION, decryptNotificationWebhook, encryptNotificationWebhook } from "./crypto";
import type { NotificationCategory, NotificationChannelV2, NotificationEnvironment, PublicDestinationSetting } from "./contracts";

const SLACK_HOSTS = new Set(["hooks.slack.com"]);
const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com"]);

export function validateDestinationWebhook(channel: NotificationChannelV2, raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false as const, reason: "webhook_url_invalid" }; }
  if (process.env.NODE_ENV === "test" && ["localhost", "127.0.0.1"].includes(url.hostname)) return { ok: true as const, url: raw };
  if (url.protocol !== "https:") return { ok: false as const, reason: "webhook_https_required" };
  const host = url.hostname.toLowerCase();
  if (channel === "slack" && (!SLACK_HOSTS.has(host) || !url.pathname.startsWith("/services/"))) return { ok: false as const, reason: "slack_webhook_invalid" };
  if (channel === "discord" && (!DISCORD_HOSTS.has(host) || !url.pathname.startsWith("/api/webhooks/"))) return { ok: false as const, reason: "discord_webhook_invalid" };
  return { ok: true as const, url: raw };
}

function publicRow(row: Record<string, unknown>): PublicDestinationSetting {
  return {
    id: String(row.id), category: row.category as NotificationCategory,
    environment: row.environment as NotificationEnvironment, channel: row.channel as NotificationChannelV2,
    enabled: Boolean(row.enabled), configured: Boolean(row.webhook_ciphertext),
    destinationLabel: typeof row.destination_label === "string" ? row.destination_label : null,
    externalDestinationHint: typeof row.external_destination_hint === "string" ? row.external_destination_hint : null,
    configuredAt: typeof row.configured_at === "string" ? row.configured_at : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
    lastTestAt: typeof row.last_test_at === "string" ? row.last_test_at : null,
    lastErrorAt: typeof row.last_error_at === "string" ? row.last_error_at : null,
    lastErrorSummary: typeof row.last_error_summary === "string" ? row.last_error_summary : null,
    retryState: row.retry_state && typeof row.retry_state === "object" ? row.retry_state as Record<string, unknown> : {},
  };
}

export async function listDestinationSettings() {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from("notification_destination_settings")
    .select("id,category,environment,channel,enabled,webhook_ciphertext,destination_label,external_destination_hint,configured_at,updated_at,last_success_at,last_test_at,last_error_at,last_error_summary,retry_state")
    .order("category").order("channel").order("environment");
  if (error) throw new Error(`notification_settings_read_failed:${error.code || "unknown"}`);
  return (data ?? []).map((row) => publicRow(row as Record<string, unknown>));
}

export async function updateDestinationSetting(input: {
  category: NotificationCategory; environment: NotificationEnvironment; channel: NotificationChannelV2;
  enabled?: boolean; webhookUrl?: string; clearWebhook?: boolean;
  destinationLabel?: string | null; externalDestinationHint?: string | null;
}) {
  const supabase = createSupabaseClient();
  const { data: existing, error: readError } = await supabase.from("notification_destination_settings").select("*")
    .eq("category", input.category).eq("environment", input.environment).eq("channel", input.channel).single();
  if (readError || !existing) throw new Error("notification_destination_missing");
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.enabled === "boolean") patch.enabled = input.enabled;
  if (input.clearWebhook) {
    patch.webhook_ciphertext = null; patch.webhook_key_version = null; patch.configured_at = null; patch.enabled = false;
  } else if (input.webhookUrl) {
    const valid = validateDestinationWebhook(input.channel, input.webhookUrl);
    if (!valid.ok) throw new Error(valid.reason);
    const encrypted = encryptNotificationWebhook(valid.url);
    patch.webhook_ciphertext = encrypted.ciphertext;
    patch.webhook_key_version = encrypted.keyVersion;
    patch.configured_at = new Date().toISOString();
  }
  if (input.destinationLabel !== undefined) patch.destination_label = String(input.destinationLabel || "").slice(0, 80) || null;
  if (input.externalDestinationHint !== undefined) patch.external_destination_hint = String(input.externalDestinationHint || "").slice(0, 80) || null;
  const { data, error } = await supabase.from("notification_destination_settings").update(patch).eq("id", existing.id)
    .select("id,category,environment,channel,enabled,webhook_ciphertext,destination_label,external_destination_hint,configured_at,updated_at,last_success_at,last_test_at,last_error_at,last_error_summary,retry_state").single();
  if (error) throw new Error(`notification_settings_write_failed:${error.code || "unknown"}`);
  return publicRow(data as Record<string, unknown>);
}

export async function loadDestinationSecret(id: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from("notification_destination_settings")
    .select("id,category,environment,channel,enabled,webhook_ciphertext,webhook_key_version").eq("id", id).single();
  if (error || !data) throw new Error("notification_destination_missing");
  if (!data.enabled || !data.webhook_ciphertext || !data.webhook_key_version) return { ...data, configured: false, webhookUrl: "" };
  return { ...data, configured: true, webhookUrl: decryptNotificationWebhook(String(data.webhook_ciphertext), String(data.webhook_key_version || CURRENT_NOTIFICATION_KEY_VERSION)) };
}
