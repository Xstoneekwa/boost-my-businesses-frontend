import { createSupabaseClient } from "@/lib/supabase";
import {
  recordNotificationDeliveryResult,
  resolveEffectiveNotificationChannel,
  validateNotificationWebhookUrl,
  type NotificationChannel,
} from "./incident-notification-settings";

type IncidentMessageFacts = {
  id: string;
  accountUsername?: string | null;
  incidentType?: string | null;
  reason?: string | null;
  resolutionReason?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
};

function shortId(value: string | null | undefined): string {
  const normalized = String(value || "").trim();
  return normalized ? `${normalized.slice(0, 8)}…` : "unknown";
}

export function buildIncidentResolutionMessage(facts: IncidentMessageFacts): string {
  return [
    "Incident resolved",
    `Account: @${facts.accountUsername || "unknown"}`,
    `Type/reason: ${facts.incidentType || "unknown_incident"} / ${facts.reason || "unknown"}`,
    `Resolution: ${facts.resolutionReason || "operator_confirmed"}`,
    `Operator: ${shortId(facts.resolvedBy)}`,
    `Timestamp: ${facts.resolvedAt || new Date().toISOString()}`,
    `Incident: ${shortId(facts.id)}`,
  ].join("\n");
}

function channelPayload(channel: NotificationChannel, message: string) {
  return channel === "slack" ? { text: message } : { content: message };
}

async function finalizeDelivery(input: {
  id: string;
  channel: NotificationChannel;
  ok: boolean;
  attemptCount: number;
  statusCode?: number | null;
  error?: string | null;
}) {
  const supabase = createSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("account_incident_notifications")
    .update({
      status: input.ok ? "sent" : "failed",
      attempt_count: Math.max(1, input.attemptCount),
      last_attempt_at: now,
      delivered_at: input.ok ? now : null,
      response_status: input.statusCode ?? null,
      response_body_preview: input.ok ? "provider accepted redacted payload" : null,
      last_error: input.ok ? null : (input.error || "webhook_request_failed").slice(0, 120),
      updated_at: now,
    })
    .eq("id", input.id)
    .eq("status", "pending");
  if (error) throw new Error(`incident_delivery_finalize_failed:${error.code ?? "unknown"}`);
  await recordNotificationDeliveryResult({
    channel: input.channel,
    ok: input.ok,
    errorRedacted: input.ok ? null : input.error,
  });
  return {
    id: input.id,
    channel: input.channel,
    status: input.ok ? "sent" : "failed",
    attemptCount: Math.max(1, input.attemptCount),
    error: input.ok ? null : input.error || "webhook_request_failed",
  };
}

async function sendOne(row: Record<string, unknown>, facts: IncidentMessageFacts) {
  const id = String(row.id || "").trim();
  const channel = String(row.channel || "").trim().toLowerCase() as NotificationChannel;
  const attemptCount = Math.max(1, Number(row.attempt_count ?? 0));
  if (!id || (channel !== "slack" && channel !== "discord")) {
    return { id, channel, status: "failed", attemptCount, error: "invalid_delivery_contract" };
  }

  const effective = await resolveEffectiveNotificationChannel(channel);
  const validated = effective.sendAllowed
    ? validateNotificationWebhookUrl(channel, effective.webhookUrl)
    : { ok: false as const, reason: effective.reason || "channel_not_configured" };
  if (!validated.ok || !("url" in validated) || !validated.url) {
    return finalizeDelivery({
      id,
      channel,
      ok: false,
      attemptCount,
      error: validated.reason,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(validated.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(channelPayload(channel, buildIncidentResolutionMessage(facts))),
      signal: controller.signal,
    });
    return finalizeDelivery({
      id,
      channel,
      ok: response.ok,
      attemptCount,
      statusCode: response.status,
      error: response.ok ? null : `http_status_${response.status}`,
    });
  } catch (error) {
    return finalizeDelivery({
      id,
      channel,
      ok: false,
      attemptCount,
      error: error instanceof DOMException && error.name === "AbortError" ? "request_timeout" : "webhook_request_failed",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchIncidentLifecycleNotifications(input: {
  incidentId: string;
  notificationIds: string[];
  facts: IncidentMessageFacts;
}) {
  if (!input.notificationIds.length) return [];
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("account_incident_notifications")
    .select("id,incident_id,channel,status,attempt_count,delivery_key")
    .eq("incident_id", input.incidentId)
    .in("id", input.notificationIds)
    .eq("status", "pending");
  if (error) throw new Error(`incident_delivery_load_failed:${error.code ?? "unknown"}`);
  const results = await Promise.allSettled((data ?? []).map((row) => sendOne(row, input.facts)));
  return results.map((result, index) => result.status === "fulfilled"
    ? result.value
    : {
        id: String(data?.[index]?.id || ""),
        channel: String(data?.[index]?.channel || "unknown"),
        status: "failed",
        attemptCount: Math.max(1, Number(data?.[index]?.attempt_count ?? 0)),
        error: "delivery_finalize_failed",
      });
}
