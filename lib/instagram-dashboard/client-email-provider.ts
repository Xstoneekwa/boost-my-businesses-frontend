import type { ClientEmailTemplateCategory } from "./client-email-constants.ts";
import { CLIENT_EMAIL_LOCKED_FROM } from "./client-email-constants.ts";
import type { ClientEmailSendTrigger } from "./client-email-constants.ts";
import type { ClientEmailDeliveryStatus } from "./client-email-constants.ts";
import type { ClientEmailSendingGateResult } from "./client-email-provider-config.ts";

export const CLIENT_EMAIL_POSTMARK_STREAM = "outbound" as const;
export const CLIENT_EMAIL_POSTMARK_PROVIDER = "postmark" as const;

export const CLIENT_EMAIL_POSTMARK_METADATA_KEYS = [
  "intent_id",
  "category",
  "account_id",
  "trigger",
  "reminder_index",
] as const;

export type ClientEmailPostmarkMetadataKey = (typeof CLIENT_EMAIL_POSTMARK_METADATA_KEYS)[number];

export type ClientEmailProviderSendPayload = {
  intentId: string;
  fromEmail: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  messageStream: typeof CLIENT_EMAIL_POSTMARK_STREAM;
  category: ClientEmailTemplateCategory;
  accountId: string;
  trigger: ClientEmailSendTrigger;
  reminderIndex: number | null;
};

export type ClientEmailProviderSendSuccess = {
  ok: true;
  provider: typeof CLIENT_EMAIL_POSTMARK_PROVIDER;
  providerMessageId: string;
  deliveryStatus: Extract<ClientEmailDeliveryStatus, "queued" | "sent">;
};

export type ClientEmailProviderSendFailure = {
  ok: false;
  reason:
    | "sending_disabled"
    | "provider_not_configured"
    | "postmark_token_missing"
    | "invalid_from_email"
    | "invalid_recipient_email"
    | "forbidden_metadata"
    | "sending_disabled";
  message: string;
};

export type ClientEmailProviderSendResult = ClientEmailProviderSendSuccess | ClientEmailProviderSendFailure;

export type ClientEmailProviderAdapter = {
  provider: typeof CLIENT_EMAIL_POSTMARK_PROVIDER;
  send: (payload: ClientEmailProviderSendPayload) => Promise<ClientEmailProviderSendResult>;
};

export type PreparedPostmarkSendRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: Record<string, unknown>;
};
