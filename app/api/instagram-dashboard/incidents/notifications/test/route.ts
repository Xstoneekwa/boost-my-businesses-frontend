import {
  loadDecryptedWebhook,
  recordNotificationDeliveryResult,
  type NotificationChannel,
  validateNotificationWebhookUrl,
} from "@/lib/instagram-dashboard/incident-notification-settings";
import { createSupabaseClient } from "@/lib/supabase";
import {
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
} from "../../../_utils";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";

type TestBody = {
  channel?: unknown;
};

async function latestActiveIncidentId() {
  const supabase = createSupabaseClient();
  const { data } = await supabase
    .from("account_incidents")
    .select("id,account_id")
    .in("status", ["open", "acknowledged"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return typeof data?.id === "string" ? { id: data.id, accountId: typeof data.account_id === "string" ? data.account_id : null } : null;
}

async function postTestWebhook(channel: NotificationChannel, webhookUrl: string) {
  const payload = channel === "slack"
    ? { text: "[TEST] Incident notification channel test (local integration)." }
    : { content: "[TEST] Incident notification channel test (local integration)." };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return {
      ok: false as const,
      errorRedacted: `http_status_${response.status}`,
    };
  }
  return { ok: true as const };
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Incident notification test");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = (await readJsonBody<TestBody>(request)) ?? {};
    const channel = readString(body.channel).trim().toLowerCase() as NotificationChannel;
    if (channel !== "slack" && channel !== "discord") {
      return jsonError("Invalid notification channel.", 400);
    }

    const supabase = createSupabaseClient();
    const { data: row, error: settingsError } = await supabase
      .from("incident_notification_channel_settings")
      .select("enabled,configured")
      .eq("channel", channel)
      .maybeSingle();

    if (settingsError) {
      return jsonError("Notification settings storage is unavailable.", 503, {
        reason: "notification_settings_storage_unavailable",
        channel,
      });
    }
    if (!row?.configured) {
      return jsonError("Channel not configured.", 409, { reason: "channel_not_configured", channel });
    }
    if (!row.enabled) {
      return jsonError("Channel disabled.", 409, { reason: "channel_disabled", channel });
    }

    const webhookUrl = await loadDecryptedWebhook(channel);
    const validated = validateNotificationWebhookUrl(channel, webhookUrl);
    if (!validated.ok || !validated.url) {
      return jsonError("Webhook not configured.", 409, { reason: "channel_not_configured", channel });
    }

    const result = await postTestWebhook(channel, validated.url);
    await recordNotificationDeliveryResult({
      channel,
      ok: result.ok,
      errorRedacted: result.ok ? null : result.errorRedacted,
      test: true,
    });

    const incident = await latestActiveIncidentId();
    if (incident) {
      const now = new Date().toISOString();
      const { error: outboxError } = await supabase.from("account_incident_notifications").insert({
        incident_id: incident.id,
        channel,
        status: result.ok ? "sent" : "failed",
        target: "redacted_loopback",
        delivery_key: `botapp-test:${channel}:${randomUUID()}`,
        attempt_count: 1,
        last_attempt_at: now,
        delivered_at: result.ok ? now : null,
        last_error: result.ok ? null : result.errorRedacted,
        response_status: result.ok ? 200 : null,
        response_body_preview: result.ok ? "loopback accepted" : null,
        payload: { test: true, source: "incident_notification_test" },
        metadata: { redacted: true, channel, loopback_only: true },
        updated_at: now,
      });
      if (outboxError) throw new Error(`notification_test_outbox_write_failed:${outboxError.message}`);

      if (incident.accountId) {
        const { error: auditError } = await supabase.from("account_dashboard_actions").insert({
          account_id: incident.accountId,
          incident_id: incident.id,
          action_type: "incident_notification_test",
          status: result.ok ? "acknowledged" : "pending_verification",
          severity: result.ok ? "info" : "warning",
          audience: "admin",
          requires_client_action: false,
          blocking_campaign: false,
          title: "incident_notification_test",
          safe_client_message: "incident_notification_test",
          admin_message: "incident_notification_test",
          action_label: "incident_notification_test",
          dedupe_key: `incident-notification-test:${channel}:${randomUUID()}`,
          metadata: { channel, ok: result.ok, redacted: true, loopback_only: true },
          created_at: now,
          updated_at: now,
        });
        if (auditError) throw new Error(`notification_test_audit_write_failed:${auditError.message}`);
      }
    }

    await supabase.from("ig_action_logs").insert({
      action_type: "incident_notification_test",
      status: result.ok ? "success" : "failed",
      message: "incident_notification_test",
      payload: { channel, ok: result.ok },
    });

    if (!result.ok) {
      return jsonError("Test notification failed.", 502, {
        reason: result.errorRedacted,
        channel,
      });
    }

    return jsonOk({ channel, status: "success" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Test notification failed.";
    return jsonError(message, 500);
  }
}
