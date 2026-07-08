import {
  integrationLocalNotificationMode,
  resolveEffectiveNotificationChannel,
  type NotificationChannel,
} from "./incident-notification-settings.ts";

const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "cookie",
  "webhook",
  "serial",
  "package",
  "clone",
  "device_id",
  "app_instance_id",
  "verification_code",
]);

function dashboardBaseUrl() {
  const base = String(process.env.INCIDENT_NOTIFICATIONS_DASHBOARD_BASE_URL || "").trim().replace(/\/$/, "");
  if (base) return base;
  const vercel = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (!vercel) return "";
  return vercel.startsWith("http") ? vercel.replace(/\/$/, "") : `https://${vercel.replace(/\/$/, "")}`;
}

function redactPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactPayload);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowered) || lowered.includes("password") || lowered.includes("code")) {
      continue;
    }
    out[key] = redactPayload(child);
  }
  return out;
}

async function postWebhook(channel: NotificationChannel, webhookUrl: string, body: Record<string, unknown>) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`http_status_${response.status}`);
  }
}

export async function sendClientAssistedLoginNotification(input: {
  accountUsername: string;
  actionId: string;
  deepLink: string;
  reservationId: string;
}) {
  if (process.env.CLIENT_ASSISTED_LOGIN_NOTIFICATIONS_ENABLED === "false") {
    return { skipped: true, reason: "disabled" };
  }

  const base = dashboardBaseUrl();
  const secureUrl = base
    ? `${base}${input.deepLink.startsWith("/") ? input.deepLink : `/${input.deepLink}`}`
    : input.deepLink;

  const text = [
    "Client assisted connection requested",
    `Account: @${input.accountUsername}`,
    "Open the secure admin action",
    secureUrl,
  ].join("\n");

  const payload = redactPayload({
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "*Client assisted connection requested*" } },
      { type: "section", text: { type: "mrkdwn", text: `Account: @${input.accountUsername}` } },
      { type: "section", text: { type: "mrkdwn", text: `<${secureUrl}|Open the secure admin action>` } },
    ],
  }) as Record<string, unknown>;

  if (integrationLocalNotificationMode()) {
    return { skipped: true, reason: "integration_local", payload };
  }

  const channels: NotificationChannel[] = ["slack", "discord"];
  const deliveries: Array<{ channel: NotificationChannel; status: string }> = [];

  for (const channel of channels) {
    const settings = await resolveEffectiveNotificationChannel(channel);
    if (!settings.sendAllowed || !settings.webhookUrl) {
      deliveries.push({ channel, status: "skipped_not_configured" });
      continue;
    }
    try {
      const body = channel === "discord"
        ? { content: text }
        : payload;
      await postWebhook(channel, settings.webhookUrl, body);
      deliveries.push({ channel, status: "sent" });
    } catch (error) {
      deliveries.push({
        channel,
        status: `failed:${error instanceof Error ? error.message : "unknown"}`,
      });
    }
  }

  return { skipped: false, deliveries };
}
