import { randomUUID } from "node:crypto";
import { createSupabaseClient } from "@/lib/supabase";
import { loadDestinationSecret, validateDestinationWebhook } from "./settings";
import { providerPayload, renderBusinessMessage } from "./templates";
import type { NotificationBusinessEventInput, NotificationChannelV2 } from "./contracts";

function safeError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "request_timeout";
  return "webhook_request_failed";
}

export async function dispatchNotificationBatch(limit = 20, owner = `notification-router:${randomUUID()}`) {
  const supabase = createSupabaseClient();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_notification_deliveries_v2", { p_claim_owner: owner, p_limit: limit });
  if (claimError) throw new Error(`notification_claim_failed:${claimError.code || "unknown"}`);
  const results = [];
  for (const delivery of claimed ?? []) {
    const startedAt = new Date().toISOString();
    let success = false;
    let httpStatus: number | null = null;
    let errorSummary: string | null = null;
    try {
      const [{ data: event, error: eventError }, destination] = await Promise.all([
        supabase.from("notification_business_events").select("category,environment,event_type,business_payload").eq("id", delivery.event_id).single(),
        loadDestinationSecret(String(delivery.destination_id)),
      ]);
      if (eventError || !event) throw new Error("business_event_missing");
      if (!destination.enabled || !destination.configured) {
        const { data: skipped, error: skipError } = await supabase.rpc("skip_notification_delivery_v2", {
          p_delivery_id: delivery.id,
          p_claim_owner: owner,
          p_reason: "destination_disabled_or_unconfigured",
        });
        if (skipError) throw new Error(`notification_skip_failed:${skipError.code || "unknown"}`);
        results.push(skipped);
        continue;
      }
      const valid = validateDestinationWebhook(destination.channel as NotificationChannelV2, destination.webhookUrl);
      if (!valid.ok) throw new Error(valid.reason);
      const message = renderBusinessMessage({
        category: event.category,
        environment: event.environment,
        eventType: event.event_type,
        businessPayload: event.business_payload,
      } as NotificationBusinessEventInput);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(valid.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(providerPayload(destination.channel as NotificationChannelV2, message)), signal: controller.signal });
        httpStatus = response.status;
        success = response.ok;
        errorSummary = response.ok ? null : `http_status_${response.status}`;
      } finally { clearTimeout(timer); }
    } catch (error) {
      errorSummary = safeError(error);
    }
    const { data: completed, error: completeError } = await supabase.rpc("complete_notification_delivery_attempt_v2", {
      p_delivery_id: delivery.id, p_claim_owner: owner, p_started_at: startedAt,
      p_success: success, p_http_status: httpStatus, p_error_summary: errorSummary,
    });
    if (completeError) throw new Error(`notification_complete_failed:${completeError.code || "unknown"}`);
    results.push(completed);
  }
  return results;
}
