import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createSupabaseClient } from "@/lib/supabase";

export type NotificationChannel = "slack" | "discord";

export type NotificationChannelPublicSettings = {
  channel: NotificationChannel;
  enabled: boolean;
  configured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorRedacted: string | null;
  lastTestAt: string | null;
  lastTestStatus: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
};

const CHANNELS: NotificationChannel[] = ["slack", "discord"];

const SLACK_WEBHOOK_HOSTS = new Set(["hooks.slack.com"]);
const DISCORD_WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com"]);

function encryptionKey() {
  const raw = (process.env.INCIDENT_NOTIFICATION_WEBHOOK_ENCRYPTION_KEY || "").trim()
    || createHash("sha256").update(`local-incident-notif:${process.env.SUPABASE_SERVICE_ROLE_KEY || "dev"}`).digest("hex");
  return createHash("sha256").update(raw).digest();
}

function encryptWebhook(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptWebhook(ciphertext: string | null | undefined) {
  const raw = String(ciphertext || "").trim();
  if (!raw) return "";
  const buf = Buffer.from(raw, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function redactError(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (
    lowered.includes("webhook")
    || lowered.includes("hooks.slack.com")
    || lowered.includes("discord.com")
    || lowered.includes("token")
    || lowered.includes("secret")
  ) {
    return "webhook_request_failed";
  }
  return text.slice(0, 240);
}

export function integrationLocalNotificationMode() {
  return process.env.INCIDENT_CAPTURE_LOCAL === "1"
    || process.env.INCIDENT_NOTIFICATIONS_INTEGRATION_LOCAL === "1"
    || process.env.NODE_ENV === "development";
}

export function validateNotificationWebhookUrl(channel: NotificationChannel, urlValue: string) {
  const urlText = String(urlValue || "").trim();
  if (!urlText) return { ok: false as const, reason: "webhook_url_required" };
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    return { ok: false as const, reason: "webhook_url_invalid" };
  }

  if (integrationLocalNotificationMode()) {
    const host = parsed.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") {
      return { ok: false as const, reason: "integration_local_loopback_only" };
    }
    return { ok: true as const, url: urlText };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false as const, reason: "webhook_https_required" };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
    return { ok: false as const, reason: "webhook_private_host_forbidden" };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { ok: false as const, reason: "webhook_private_host_forbidden" };
  }
  if (channel === "slack" && !SLACK_WEBHOOK_HOSTS.has(host)) {
    return { ok: false as const, reason: "slack_webhook_host_invalid" };
  }
  if (channel === "discord" && !DISCORD_WEBHOOK_HOSTS.has(host)) {
    return { ok: false as const, reason: "discord_webhook_host_invalid" };
  }
  if (channel === "slack" && !parsed.pathname.startsWith("/services/")) {
    return { ok: false as const, reason: "slack_webhook_path_invalid" };
  }
  if (channel === "discord" && !parsed.pathname.startsWith("/api/webhooks/")) {
    return { ok: false as const, reason: "discord_webhook_path_invalid" };
  }
  return { ok: true as const, url: urlText };
}

function mapRow(channel: NotificationChannel, row: Record<string, unknown> | null | undefined): NotificationChannelPublicSettings {
  return {
    channel,
    enabled: Boolean(row?.enabled),
    configured: Boolean(row?.configured),
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
    updatedBy: typeof row?.updated_by === "string" ? row.updated_by : null,
    lastSuccessAt: typeof row?.last_success_at === "string" ? row.last_success_at : null,
    lastFailureAt: typeof row?.last_failure_at === "string" ? row.last_failure_at : null,
    lastErrorRedacted: typeof row?.last_error_redacted === "string" ? row.last_error_redacted : null,
    lastTestAt: typeof row?.last_test_at === "string" ? row.last_test_at : null,
    lastTestStatus: typeof row?.last_test_status === "string" ? row.last_test_status : null,
    attemptCount: Number(row?.attempt_count ?? 0),
    nextRetryAt: typeof row?.next_retry_at === "string" ? row.next_retry_at : null,
  };
}

export async function getIncidentNotificationSettingsPublic() {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("incident_notification_channel_settings")
    .select("channel,enabled,configured,updated_at,updated_by,last_success_at,last_failure_at,last_error_redacted,last_test_at,last_test_status,attempt_count,next_retry_at")
    .in("channel", CHANNELS);
  if (error) {
    return {
      ok: false as const,
      error: error.message,
      channels: CHANNELS.map((channel) => mapRow(channel, null)),
    };
  }
  const byChannel = new Map((data ?? []).map((row) => [String(row.channel), row]));
  return {
    ok: true as const,
    channels: CHANNELS.map((channel) => mapRow(channel, byChannel.get(channel) as Record<string, unknown> | undefined)),
  };
}

export async function loadDecryptedWebhook(channel: NotificationChannel) {
  const effective = await resolveEffectiveNotificationChannel(channel);
  return effective.sendAllowed ? effective.webhookUrl : "";
}

export async function resolveEffectiveNotificationChannel(channel: NotificationChannel) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("incident_notification_channel_settings")
    .select("webhook_ciphertext,enabled,configured")
    .eq("channel", channel)
    .maybeSingle();

  if (error) {
    return {
      channel,
      rowPresent: false,
      enabled: false,
      configured: false,
      webhookUrl: "",
      sendAllowed: false,
      source: "none" as const,
      reason: "channel_not_configured" as const,
    };
  }

  if (data) {
    if (!data.enabled) {
      return {
        channel,
        rowPresent: true,
        enabled: false,
        configured: Boolean(data.configured),
        webhookUrl: "",
        sendAllowed: false,
        source: "canonical" as const,
        reason: "channel_disabled" as const,
      };
    }
    if (!data.configured || !data.webhook_ciphertext) {
      return {
        channel,
        rowPresent: true,
        enabled: true,
        configured: false,
        webhookUrl: "",
        sendAllowed: false,
        source: "canonical" as const,
        reason: "channel_not_configured" as const,
      };
    }
    try {
      const webhookUrl = decryptWebhook(String(data.webhook_ciphertext));
      if (!webhookUrl.trim()) {
        return {
          channel,
          rowPresent: true,
          enabled: true,
          configured: true,
          webhookUrl: "",
          sendAllowed: false,
          source: "canonical" as const,
          reason: "channel_not_configured" as const,
        };
      }
      return {
        channel,
        rowPresent: true,
        enabled: true,
        configured: true,
        webhookUrl,
        sendAllowed: true,
        source: "canonical" as const,
        reason: null,
      };
    } catch {
      return {
        channel,
        rowPresent: true,
        enabled: true,
        configured: true,
        webhookUrl: "",
        sendAllowed: false,
        source: "canonical" as const,
        reason: "channel_not_configured" as const,
      };
    }
  }

  return {
    channel,
    rowPresent: false,
    enabled: false,
    configured: false,
    webhookUrl: "",
    sendAllowed: false,
    source: "none" as const,
    reason: "channel_not_configured" as const,
  };
}

type PatchChannelInput = {
  enabled?: boolean;
  webhook_url?: string;
  clear_webhook?: boolean;
};

export async function patchIncidentNotificationSettings(input: {
  slack?: PatchChannelInput;
  discord?: PatchChannelInput;
  actorId?: string | null;
  source?: string;
}) {
  const supabase = createSupabaseClient();
  const now = new Date().toISOString();
  const results: NotificationChannelPublicSettings[] = [];

  for (const channel of CHANNELS) {
    const patch = input[channel];
    if (!patch) continue;

    const { data: existing } = await supabase
      .from("incident_notification_channel_settings")
      .select("*")
      .eq("channel", channel)
      .maybeSingle();

    let webhookCiphertext = typeof existing?.webhook_ciphertext === "string" ? existing.webhook_ciphertext : null;
    let configured = Boolean(existing?.configured);
    let enabled = typeof patch.enabled === "boolean" ? patch.enabled : Boolean(existing?.enabled);

    if (patch.clear_webhook) {
      webhookCiphertext = null;
      configured = false;
      enabled = false;
    } else if (typeof patch.webhook_url === "string" && patch.webhook_url.trim()) {
      const validated = validateNotificationWebhookUrl(channel, patch.webhook_url);
      if (!validated.ok) {
        return { ok: false as const, reason: validated.reason, channel };
      }
      webhookCiphertext = encryptWebhook(validated.url);
      configured = true;
    }

    const row = {
      channel,
      enabled,
      configured,
      webhook_ciphertext: webhookCiphertext,
      updated_at: now,
      updated_by: input.actorId || input.source || "admin_dashboard",
      metadata: {
        ...(typeof existing?.metadata === "object" && existing?.metadata ? existing.metadata : {}),
        last_settings_action: patch.clear_webhook ? "clear_webhook" : "patch",
        last_settings_source: input.source || "admin_dashboard",
      },
    };

    const { data, error } = await supabase
      .from("incident_notification_channel_settings")
      .upsert(row, { onConflict: "channel" })
      .select("channel,enabled,configured,updated_at,updated_by,last_success_at,last_failure_at,last_error_redacted,last_test_at,last_test_status,attempt_count,next_retry_at")
      .single();

    if (error) {
      return { ok: false as const, reason: "settings_write_failed", channel, error: error.message };
    }

    await supabase.from("ig_action_logs").insert({
      action_type: patch.clear_webhook ? "incident_notification_webhook_cleared" : "incident_notification_settings_updated",
      status: "success",
      message: patch.clear_webhook ? "incident_notification_webhook_cleared" : "incident_notification_settings_updated",
      payload: {
        channel,
        enabled,
        configured,
        source: input.source || "admin_dashboard",
      },
    });

    results.push(mapRow(channel, data as Record<string, unknown>));
  }

  const publicView = await getIncidentNotificationSettingsPublic();
  return { ok: true as const, channels: publicView.channels };
}

export async function recordNotificationDeliveryResult(input: {
  channel: NotificationChannel;
  ok: boolean;
  errorRedacted?: string | null;
  test?: boolean;
}) {
  const supabase = createSupabaseClient();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    updated_at: now,
  };
  if (input.test) {
    patch.last_test_at = now;
    patch.last_test_status = input.ok ? "success" : "failed";
  }
  if (input.ok) {
    patch.last_success_at = now;
    patch.last_error_redacted = null;
  } else {
    patch.last_failure_at = now;
    patch.last_error_redacted = redactError(input.errorRedacted || "webhook_request_failed");
    patch.attempt_count = undefined;
  }
  const { data: existing } = await supabase
    .from("incident_notification_channel_settings")
    .select("attempt_count")
    .eq("channel", input.channel)
    .maybeSingle();
  if (!input.ok) {
    patch.attempt_count = Number(existing?.attempt_count ?? 0) + 1;
  }
  await supabase.from("incident_notification_channel_settings").update(patch).eq("channel", input.channel);
}
