import { createSupabaseClient } from "../supabase.ts";

type SupabaseRecord = Record<string, unknown>;
type NotificationChannel = "slack" | "discord";
type ResolveChannel = (channel: NotificationChannel) => Promise<{
  sendAllowed: boolean;
  webhookUrl: string;
  reason: string | null;
}>;
type RecordResult = (input: {
  channel: NotificationChannel;
  ok: boolean;
  errorRedacted?: string | null;
}) => Promise<void>;

export type OperatorReviewNotificationEvent = "created" | "resolved";

export type OperatorReviewNotificationInput = {
  event: OperatorReviewNotificationEvent;
  actionId: string;
  incidentId: string;
  accountId: string;
  accountUsername: string;
  reason: string;
  finalStatus: string;
  operatorId: string;
};

type NotificationDependencies = {
  supabase?: unknown;
  now?: () => Date;
  resolveChannel?: ResolveChannel;
  recordResult?: RecordResult;
  postWebhook?: (channel: NotificationChannel, webhookUrl: string, body: Record<string, unknown>) => Promise<number>;
};

function shortId(value: string) {
  return value ? `${value.slice(0, 8)}...` : "unknown";
}

const CANONICAL_INCIDENTS_URL = "https://www.boostmybusinesses.com/instagram-dashboard/incidents";
const ACTION_CTA_LABEL = "Open Incidents/Actions";

export function operatorReviewActionUrl(input: Pick<OperatorReviewNotificationInput, "incidentId">) {
  const url = new URL(CANONICAL_INCIDENTS_URL);
  if (input.incidentId) url.searchParams.set("incident_id", input.incidentId);
  return url.toString();
}

export function buildOperatorReviewNotificationText(input: OperatorReviewNotificationInput) {
  const title = input.event === "created"
    ? "Operator review required"
    : "Operator review resolved";
  return [
    title,
    `Account: @${input.accountUsername || "unknown"} (${shortId(input.accountId)})`,
    `Reason: ${input.reason || "operator_review_required"}`,
    `State: ${input.finalStatus}`,
    `Operator: ${input.operatorId || "system"}`,
    `Action: ${shortId(input.actionId)}`,
  ].join("\n");
}

async function defaultPostWebhook(
  _channel: NotificationChannel,
  webhookUrl: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`http_status_${response.status}`);
  return response.status;
}

function deliveryKey(channel: NotificationChannel, input: OperatorReviewNotificationInput) {
  return `${channel}:${input.incidentId}:operator_review_${input.event}:${input.actionId}`;
}

export async function deliverOperatorReviewNotifications(
  input: OperatorReviewNotificationInput,
  dependencies: NotificationDependencies = {},
) {
  const supabase = (dependencies.supabase ?? createSupabaseClient()) as ReturnType<typeof createSupabaseClient>;
  const now = dependencies.now ?? (() => new Date());
  let notificationSettings: typeof import("./incident-notification-settings.ts") | null = null;
  if (!dependencies.resolveChannel || !dependencies.recordResult) {
    try {
      notificationSettings = await import("./incident-notification-settings.ts");
    } catch {
      return (["slack", "discord"] as const).map((channel) => ({
        channel,
        status: "skipped_notification_module_unavailable",
        deliveredAt: null,
      }));
    }
  }
  const resolveChannel = dependencies.resolveChannel ?? notificationSettings!.resolveEffectiveNotificationChannel;
  const recordResult = dependencies.recordResult ?? notificationSettings!.recordNotificationDeliveryResult;
  const postWebhook = dependencies.postWebhook ?? defaultPostWebhook;
  const text = buildOperatorReviewNotificationText(input);
  const actionUrl = operatorReviewActionUrl(input);
  const results: Array<{ channel: NotificationChannel; status: string; deliveredAt: string | null }> = [];

  for (const channel of ["slack", "discord"] as const) {
    const key = deliveryKey(channel, input);
    const { data: existing } = await supabase
      .from("account_incident_notifications")
      .select("id,status,attempt_count,delivered_at")
      .eq("delivery_key", key)
      .maybeSingle<SupabaseRecord>();

    if (String(existing?.status || "") === "sent") {
      results.push({
        channel,
        status: "sent",
        deliveredAt: typeof existing?.delivered_at === "string" ? existing.delivered_at : null,
      });
      continue;
    }

    const pendingAt = now().toISOString();
    if (!existing) {
      const { error: insertError } = await supabase.from("account_incident_notifications").insert({
        incident_id: input.incidentId,
        channel,
        status: "pending",
        target: "redacted",
        delivery_key: key,
        attempt_count: 0,
        payload: {
          source: "operator_review",
          event: input.event,
          action_id: input.actionId,
          account_id_short: shortId(input.accountId),
          account_username: input.accountUsername,
          reason: input.reason,
          final_status: input.finalStatus,
          operator_id: input.operatorId,
          text,
          cta_label: ACTION_CTA_LABEL,
          action_url: actionUrl,
        },
        metadata: {
          dispatcher: "incident_notifications",
          notification_type: `operator_review_${input.event}`,
          redacted: true,
        },
        created_at: pendingAt,
        updated_at: pendingAt,
      });
      if (insertError) throw new Error(insertError.message);
    }

    const settings = await resolveChannel(channel);
    if (!settings.sendAllowed || !settings.webhookUrl) {
      await supabase.from("account_incident_notifications").update({
        status: "skipped",
        last_error: settings.reason || "channel_not_configured",
        updated_at: pendingAt,
      }).eq("delivery_key", key);
      results.push({ channel, status: "skipped", deliveredAt: null });
      continue;
    }

    const attemptAt = now().toISOString();
    const attemptCount = Number(existing?.attempt_count ?? 0) + 1;
    try {
      const body = channel === "discord"
        ? { content: `${text}\n[${ACTION_CTA_LABEL}](${actionUrl})` }
        : {
            text: `${text}\n<${actionUrl}|${ACTION_CTA_LABEL}>`,
            blocks: [
              { type: "section", text: { type: "mrkdwn", text } },
              { type: "section", text: { type: "mrkdwn", text: `<${actionUrl}|${ACTION_CTA_LABEL}>` } },
            ],
          };
      const responseStatus = await postWebhook(channel, settings.webhookUrl, body);
      const deliveredAt = now().toISOString();
      await supabase.from("account_incident_notifications").update({
        status: "sent",
        attempt_count: attemptCount,
        last_attempt_at: attemptAt,
        delivered_at: deliveredAt,
        last_error: null,
        response_status: responseStatus,
        updated_at: deliveredAt,
      }).eq("delivery_key", key);
      await recordResult({ channel, ok: true });
      results.push({ channel, status: "sent", deliveredAt });
    } catch (error) {
      const message = error instanceof Error ? error.message : "webhook_request_failed";
      await supabase.from("account_incident_notifications").update({
        status: "failed",
        attempt_count: attemptCount,
        last_attempt_at: attemptAt,
        delivered_at: null,
        last_error: message.slice(0, 240),
        updated_at: attemptAt,
      }).eq("delivery_key", key);
      await recordResult({ channel, ok: false, errorRedacted: message });
      results.push({ channel, status: "failed", deliveredAt: null });
    }
  }

  return results;
}
