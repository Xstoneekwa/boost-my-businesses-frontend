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
const POSTMARK_SEND_TIMEOUT_MS = 30_000;

function redactProviderError(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "Postmark rejected the lifecycle delivery request.";
  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{8,}\b/g, "[redacted-token]")
    .slice(0, 500);
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

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
  if (!normalizeCommunicationEmail(payload.fromEmail)) {
    return {
      ok: false,
      reason: "invalid_from_email",
      message: "Active sender must be a valid transactional From address.",
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

      const prepared = preparePostmarkSendRequest(payload, token);
      const fetchImpl = fetcher ?? fetch;

      let response: Response;
      try {
        response = await fetchWithTimeout(fetchImpl, prepared.url, {
          method: prepared.method,
          headers: prepared.headers,
          body: JSON.stringify(prepared.body),
        }, POSTMARK_SEND_TIMEOUT_MS);
      } catch (error) {
        const message = error instanceof Error && error.name === "AbortError"
          ? "Postmark request timed out before a reliable response."
          : "Postmark request failed before a reliable response.";
        return {
          ok: false,
          reason: "provider_timeout",
          message,
        };
      }

      let body: Record<string, unknown> = {};
      try {
        body = await response.json() as Record<string, unknown>;
      } catch {
        body = {};
      }

      if (!response.ok) {
        return {
          ok: false,
          reason: "provider_error",
          message: redactProviderError(body.Message || body.ErrorCode || response.statusText),
        };
      }

      const providerMessageId = typeof body.MessageID === "string" ? body.MessageID.trim() : "";
      if (!providerMessageId) {
        return {
          ok: false,
          reason: "provider_timeout",
          message: "Postmark accepted the request but did not return a message id.",
        };
      }

      return {
        ok: true,
        provider: CLIENT_EMAIL_POSTMARK_PROVIDER,
        providerMessageId,
        deliveryStatus: "sent",
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
