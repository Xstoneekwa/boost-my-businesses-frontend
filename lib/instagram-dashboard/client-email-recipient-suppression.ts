import { CLIENT_EMAIL_DELIVERY_EVENTS_TABLE } from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

const SUPPRESSION_STATUSES = new Set(["bounced", "complained", "suppressed"]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export async function isRecipientEmailSuppressed(
  supabase: ClientEmailSupabase,
  recipientEmail: string,
): Promise<boolean> {
  const normalized = recipientEmail.trim().toLowerCase();
  if (!normalized) return false;

  const { data, error } = await supabase
    .from(CLIENT_EMAIL_DELIVERY_EVENTS_TABLE)
    .select("status,intent_id")
    .in("status", [...SUPPRESSION_STATUSES])
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    const { data: intentRow } = await supabase
      .from("client_email_send_intents")
      .select("recipient_email")
      .eq("id", readString(record.intent_id, ""))
      .maybeSingle();
    const storedRecipient = readString((intentRow as Record<string, unknown> | null)?.recipient_email, "");
    if (storedRecipient.toLowerCase() === normalized) return true;
  }

  return false;
}

export async function isIntentRecipientSuppressed(
  supabase: ClientEmailSupabase,
  intentId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(CLIENT_EMAIL_DELIVERY_EVENTS_TABLE)
    .select("status")
    .eq("intent_id", intentId)
    .in("status", [...SUPPRESSION_STATUSES])
    .limit(1);

  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
