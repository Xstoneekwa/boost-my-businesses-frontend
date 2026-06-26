import { CLIENT_EMAIL_LOCKED_FROM } from "./client-email-constants.ts";
import { normalizeCommunicationEmail } from "./client-communication-email.ts";
import {
  evaluateClientEmailSendingGate,
  readClientEmailProviderEnv,
} from "./client-email-provider-config.ts";
import {
  CLIENT_EMAIL_POSTMARK_METADATA_KEYS,
  CLIENT_EMAIL_POSTMARK_PROVIDER,
  CLIENT_EMAIL_POSTMARK_STREAM,
  type ClientEmailProviderAdapter,
  type ClientEmailProviderSendPayload,
  type ClientEmailProviderSendResult,
  type PreparedPostmarkSendRequest,
} from "./client-email-provider.ts";

const POSTMARK_EMAIL_API_URL = "https://api.postmarkapp.com/email";

function buildPostmarkMetadata(payload: ClientEmailProviderSendPayload) {
  return {
    intent_id: payload.intentId,
    category: payload.category,
    account_id: payload.accountId,
    trigger: payload.trigger,
    reminder_index: payload.reminderIndex == null ? "" : String(payload.reminderIndex),
  };
}

export function validateClientEmailProviderSendPayload(
  payload: ClientEmailProviderSendPayload,
): ClientEmailProviderSendResult | null {
  if (payload.fromEmail !== CLIENT_EMAIL_LOCKED_FROM) {
    return {
      ok: false,
      reason: "invalid_from_email",
      message: "Only growth@boostmybusinesses.com is allowed as the transactional sender.",
    };
  }
  if (!normalizeCommunicationEmail(payload.recipientEmail)) {
    return {
      ok: false,
      reason: "invalid_recipient_email",
      message: "Recipient must be a canonical client communication email.",
    };
  }
  if (payload.messageStream !== CLIENT_EMAIL_POSTMARK_STREAM) {
    return {
      ok: false,
      reason: "provider_not_configured",
      message: "Postmark transactional sends must use the outbound stream.",
    };
  }
  return null;
}

export function preparePostmarkSendRequest(
  payload: ClientEmailProviderSendPayload,
  serverToken: string,
): PreparedPostmarkSendRequest {
  return {
    url: POSTMARK_EMAIL_API_URL,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": serverToken,
    },
    body: {
      From: payload.fromEmail,
      To: payload.recipientEmail,
      Subject: payload.subject,
      TextBody: payload.bodyText,
      HtmlBody: payload.bodyHtml,
      MessageStream: CLIENT_EMAIL_POSTMARK_STREAM,
      TrackOpens: false,
      TrackLinks: "None",
      Metadata: buildPostmarkMetadata(payload),
    },
  };
}

export function createPostmarkClientEmailAdapter(
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch,
): ClientEmailProviderAdapter {
  return {
    provider: CLIENT_EMAIL_POSTMARK_PROVIDER,
    async send(payload) {
      const validationError = validateClientEmailProviderSendPayload(payload);
      if (validationError) return validationError;

      const gate = evaluateClientEmailSendingGate(env);
      if (!gate.allowed) {
        return {
          ok: false,
          reason: gate.reason,
          message: gate.message,
        };
      }

      const token = env.POSTMARK_SERVER_TOKEN?.trim() ?? "";
      if (!token) {
        return {
          ok: false,
          reason: "postmark_token_missing",
          message: "POSTMARK_SERVER_TOKEN is not configured.",
        };
      }

      const config = readClientEmailProviderEnv(env);
      if (config.provider !== "postmark") {
        return {
          ok: false,
          reason: "provider_not_configured",
          message: "CLIENT_EMAIL_PROVIDER must be postmark.",
        };
      }

      // Client lifecycle sends remain disabled until CLIENT_EMAIL_SENDING_ENABLED is explicitly enabled.
      void preparePostmarkSendRequest(payload, token);
      void fetcher;

      return {
        ok: false,
        reason: "sending_disabled",
        message: "Client email sending is disabled by CLIENT_EMAIL_SENDING_ENABLED.",
      };
    },
  };
}

export function isForbiddenPostmarkMetadataKey(key: string) {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return true;
  if (CLIENT_EMAIL_POSTMARK_METADATA_KEYS.includes(normalized as typeof CLIENT_EMAIL_POSTMARK_METADATA_KEYS[number])) {
    return false;
  }
  const forbiddenFragments = [
    "password",
    "secret",
    "token",
    "vault",
    "instagram",
    "credential",
    "session",
    "phone",
    "clone",
    "2fa",
    "code",
  ];
  return forbiddenFragments.some((fragment) => normalized.includes(fragment));
}
