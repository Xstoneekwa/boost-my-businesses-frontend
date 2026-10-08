import { createSupabaseClient } from "@/lib/supabase";
import type { NotificationBusinessEventInput } from "./contracts";

export async function emitNotificationBusinessEvent(input: NotificationBusinessEventInput) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc("emit_notification_business_event_v2", {
    p_idempotency_key: input.idempotencyKey,
    p_category: input.category,
    p_environment: input.environment,
    p_event_type: input.eventType,
    p_account_id: input.accountId ?? null,
    p_client_id: input.clientId ?? null,
    p_tenant_id: input.tenantId ?? null,
    p_business_payload: input.businessPayload,
    p_technical_diagnostics: input.technicalDiagnostics ?? {},
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  });
  if (error) throw new Error(`notification_business_event_write_failed:${error.code || "unknown"}`);
  return data;
}

export const notificationCategoryPrecedence = {
  auto_login: ["auto_login", "incident"],
  new_client: ["new_client", "incident"],
  plan_change: ["plan_change", "incident"],
  ct_lifecycle: ["ct_lifecycle", "incident"],
} as const;

export function canonicalNotificationCategory(input: { sourceCategory: string; incidentType?: string | null }) {
  const incident = String(input.incidentType || "").toLowerCase();
  if (input.sourceCategory === "auto_login" || /login|password|challenge|identity/.test(incident)) return "auto_login" as const;
  if (input.sourceCategory === "new_client") return "new_client" as const;
  if (input.sourceCategory === "plan_change") return "plan_change" as const;
  if (input.sourceCategory === "ct_lifecycle") return "ct_lifecycle" as const;
  return "incident" as const;
}
