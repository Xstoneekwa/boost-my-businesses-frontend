import type { ClientEmailDeliveryStatus } from "./client-email-constants.ts";
import { CLIENT_EMAIL_POSTMARK_PROVIDER } from "./client-email-provider.ts";
import {
  CLIENT_EMAIL_DELIVERY_EVENTS_TABLE,
  CLIENT_EMAIL_SEND_INTENTS_TABLE,
  isClientEmailInfrastructureTableMissingError,
} from "./client-email-schema-guard.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

type SupabaseRecord = Record<string, unknown>;

export type PostmarkWebhookRecordType =
  | "Delivery"
  | "Bounce"
  | "SpamComplaint"
  | "SubscriptionChange"
  | "SMTPApiError"
  | string;

export type ParsedPostmarkWebhookEvent = {
  recordType: PostmarkWebhookRecordType;
  messageId: string | null;
  messageStream: string | null;
  intentId: string | null;
  recipientEmail: string | null;
  occurredAt: string;
  providerEventId: string;
  deliveryStatus: ClientEmailDeliveryStatus;
  providerMessageId: string | null;
  lastErrorRedacted: string | null;
  metadataRedacted: SupabaseRecord;
};

export type PostmarkWebhookIngestResult =
  | { ok: true; action: "stored" | "duplicate" | "ignored"; reason?: string }
  | { ok: false; reason: "invalid_payload" | "infrastructure_unavailable" | "intent_not_found"; message: string };

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readMetadataIntentId(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const intentId = readString((metadata as SupabaseRecord).intent_id, "");
  return intentId || null;
}

function redactProviderError(value: unknown) {
  const raw = readString(value, "");
  if (!raw) return null;
  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{3,}\b/g, "[redacted-id]")
    .slice(0, 500);
}

function mapRecordTypeToDeliveryStatus(recordType: string, bounceType?: string): ClientEmailDeliveryStatus {
  if (recordType === "Delivery") return "delivered";
  if (recordType === "Bounce") return "bounced";
  if (recordType === "SpamComplaint") return "complained";
  if (recordType === "SubscriptionChange") return "suppressed";
  if (recordType === "SMTPApiError") return "failed";
  if (bounceType && bounceType.toLowerCase().includes("spam")) return "complained";
  return "failed";
}

export function buildPostmarkWebhookEventId(payload: SupabaseRecord) {
  const recordType = readString(payload.RecordType, "unknown");
  const messageId = readString(payload.MessageID, "unknown");
  const eventId = readString(payload.ID, "");
  const occurredAt = readString(
    payload.DeliveredAt
    || payload.BouncedAt
    || payload.ChangedAt
    || payload.ReceivedAt
    || payload.SubmittedAt,
    "",
  );
  return [recordType, messageId, eventId || occurredAt || "event"].join(":");
}

export function parsePostmarkWebhookPayload(payload: unknown): ParsedPostmarkWebhookEvent | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const row = payload as SupabaseRecord;
  const recordType = readString(row.RecordType, "");
  if (!recordType) return null;

  const metadata = row.Metadata && typeof row.Metadata === "object" && !Array.isArray(row.Metadata)
    ? row.Metadata as SupabaseRecord
    : {};
  const messageId = readString(row.MessageID, "") || null;
  const bounceType = readString(row.Type, "");
  const occurredAt = readString(
    row.DeliveredAt
    || row.BouncedAt
    || row.ChangedAt
    || row.ReceivedAt
    || row.SubmittedAt,
    "",
  ) || new Date().toISOString();

  return {
    recordType,
    messageId,
    messageStream: readString(row.MessageStream, "") || null,
    intentId: readMetadataIntentId(metadata),
    recipientEmail: readString(row.Recipient || row.Email, "") || null,
    occurredAt,
    providerEventId: buildPostmarkWebhookEventId(row),
    deliveryStatus: mapRecordTypeToDeliveryStatus(recordType, bounceType),
    providerMessageId: messageId,
    lastErrorRedacted: redactProviderError(row.Description || row.Details || row.ErrorCode),
    metadataRedacted: {
      record_type: recordType,
      message_stream: readString(row.MessageStream, "") || null,
      bounce_type: bounceType || null,
      suppression_reason: readString(row.SuppressionReason, "") || null,
      recipient_email: readString(row.Recipient || row.Email, "") || null,
    },
  };
}

export function shouldIgnorePostmarkWebhookEvent(event: ParsedPostmarkWebhookEvent) {
  if (event.messageStream && event.messageStream !== "outbound") {
    return { ignore: true, reason: "non_outbound_stream" };
  }
  if (event.recordType === "Open" || event.recordType === "Click" || event.recordType === "Inbound") {
    return { ignore: true, reason: "unsupported_tracking_or_inbound_event" };
  }
  if (!["Delivery", "Bounce", "SpamComplaint", "SubscriptionChange", "SMTPApiError"].includes(event.recordType)) {
    return { ignore: true, reason: "unknown_record_type" };
  }
  return { ignore: false as const };
}

type DeliveryEventsQuery = {
  select: (columns: string) => DeliveryEventsQuery;
  eq: (column: string, value: string) => DeliveryEventsQuery;
  maybeSingle: () => Promise<{ data: SupabaseRecord | null; error: unknown }>;
  insert: (values: SupabaseRecord) => Promise<{ error: unknown }>;
};

type IntentsQuery = {
  select: (columns: string) => IntentsQuery;
  eq: (column: string, value: string) => IntentsQuery;
  maybeSingle: () => Promise<{ data: SupabaseRecord | null; error: unknown }>;
};

function deliveryEventsTable(supabase: ClientEmailSupabase): DeliveryEventsQuery {
  return supabase.from(CLIENT_EMAIL_DELIVERY_EVENTS_TABLE) as unknown as DeliveryEventsQuery;
}

function intentsTable(supabase: ClientEmailSupabase): IntentsQuery {
  return supabase.from(CLIENT_EMAIL_SEND_INTENTS_TABLE) as unknown as IntentsQuery;
}

export async function ingestPostmarkWebhookEvent(
  supabase: ClientEmailSupabase,
  payload: unknown,
): Promise<PostmarkWebhookIngestResult> {
  const parsed = parsePostmarkWebhookPayload(payload);
  if (!parsed) {
    return { ok: false, reason: "invalid_payload", message: "Postmark webhook payload is invalid." };
  }

  const ignoreDecision = shouldIgnorePostmarkWebhookEvent(parsed);
  if (ignoreDecision.ignore) {
    return { ok: true, action: "ignored", reason: ignoreDecision.reason };
  }

  if (!parsed.intentId) {
    return {
      ok: true,
      action: "ignored",
      reason: "missing_intent_metadata",
    };
  }

  const duplicateCheck = await deliveryEventsTable(supabase)
    .select("id")
    .eq("webhook_event_id", parsed.providerEventId)
    .maybeSingle();

  if (duplicateCheck.error) {
    if (isClientEmailInfrastructureTableMissingError(duplicateCheck.error)) {
      return { ok: false, reason: "infrastructure_unavailable", message: "Email delivery tables are unavailable." };
    }
    return { ok: false, reason: "invalid_payload", message: "Could not verify webhook idempotency." };
  }
  if (duplicateCheck.data?.id) {
    return { ok: true, action: "duplicate" };
  }

  const intentResult = await intentsTable(supabase)
    .select("id,recipient_email,client_id")
    .eq("id", parsed.intentId)
    .maybeSingle();

  if (intentResult.error) {
    if (isClientEmailInfrastructureTableMissingError(intentResult.error)) {
      return { ok: false, reason: "infrastructure_unavailable", message: "Email intent tables are unavailable." };
    }
    return { ok: false, reason: "intent_not_found", message: "Referenced send intent is unavailable." };
  }
  if (!intentResult.data?.id) {
    return { ok: false, reason: "intent_not_found", message: "Referenced send intent was not found." };
  }

  const storedRecipient = readString(intentResult.data.recipient_email, "");
  if (parsed.recipientEmail && storedRecipient && parsed.recipientEmail.toLowerCase() !== storedRecipient.toLowerCase()) {
    return { ok: true, action: "ignored", reason: "recipient_snapshot_mismatch" };
  }

  const insertResult = await deliveryEventsTable(supabase).insert({
    intent_id: parsed.intentId,
    provider: CLIENT_EMAIL_POSTMARK_PROVIDER,
    provider_message_id: parsed.providerMessageId,
    webhook_event_id: parsed.providerEventId,
    status: parsed.deliveryStatus,
    occurred_at: parsed.occurredAt,
    last_error_redacted: parsed.lastErrorRedacted,
    metadata_redacted: parsed.metadataRedacted,
  });

  if (insertResult.error) {
    if (isClientEmailInfrastructureTableMissingError(insertResult.error)) {
      return { ok: false, reason: "infrastructure_unavailable", message: "Email delivery tables are unavailable." };
    }
    const message = typeof insertResult.error === "object"
      && insertResult.error
      && "message" in insertResult.error
      && typeof (insertResult.error as { message?: unknown }).message === "string"
      ? (insertResult.error as { message: string }).message.toLowerCase()
      : "";
    if (message.includes("duplicate") || message.includes("unique")) {
      return { ok: true, action: "duplicate" };
    }
    return { ok: false, reason: "invalid_payload", message: "Could not store Postmark delivery event." };
  }

  return { ok: true, action: "stored" };
}
