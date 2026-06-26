import { CLIENT_EMAIL_LOCKED_FROM, type ClientEmailTemplateCategory } from "./client-email-constants.ts";
import { evaluateClientEmailTestSendingGate } from "./client-email-test-config.ts";
import {
  CLIENT_EMAIL_POSTMARK_PROVIDER,
  CLIENT_EMAIL_POSTMARK_STREAM,
  type PreparedPostmarkSendRequest,
} from "./client-email-provider.ts";

const POSTMARK_EMAIL_API_URL = "https://api.postmarkapp.com/email";

export type PostmarkTestSendPayload = {
  intentId: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  category: ClientEmailTemplateCategory;
};

export type PostmarkTestSendSuccess = {
  ok: true;
  provider: typeof CLIENT_EMAIL_POSTMARK_PROVIDER;
  providerMessageId: string;
};

export type PostmarkTestSendFailure = {
  ok: false;
  reason:
    | "client_sending_must_stay_disabled"
    | "test_sending_disabled"
    | "test_recipient_missing"
    | "test_recipient_invalid"
    | "provider_not_configured"
    | "postmark_token_missing"
    | "recipient_not_allowlisted"
    | "provider_error";
  message: string;
};

export type PostmarkTestSendResult = PostmarkTestSendSuccess | PostmarkTestSendFailure;

function redactProviderError(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "Postmark rejected the test delivery request.";
  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{8,}\b/g, "[redacted-token]")
    .slice(0, 500);
}

export function preparePostmarkTestSendRequest(
  payload: PostmarkTestSendPayload,
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
      From: CLIENT_EMAIL_LOCKED_FROM,
      To: payload.recipientEmail,
      Subject: payload.subject,
      TextBody: payload.bodyText,
      HtmlBody: payload.bodyHtml,
      MessageStream: CLIENT_EMAIL_POSTMARK_STREAM,
      TrackOpens: false,
      TrackLinks: "None",
      Metadata: {
        intent_id: payload.intentId,
        is_test: "true",
        category: payload.category,
        trigger: "manual_test",
      },
    },
  };
}

export async function executePostmarkTestDeliverySend(
  payload: PostmarkTestSendPayload,
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): Promise<PostmarkTestSendResult> {
  const gate = evaluateClientEmailTestSendingGate(env);
  if (!gate.allowed) {
    return { ok: false, reason: gate.reason, message: gate.message };
  }
  if (payload.recipientEmail.toLowerCase() !== gate.recipientEmail.toLowerCase()) {
    return {
      ok: false,
      reason: "recipient_not_allowlisted",
      message: "Test delivery recipient must match CLIENT_EMAIL_TEST_RECIPIENT exactly.",
    };
  }

  const token = env.POSTMARK_SERVER_TOKEN?.trim() ?? "";
  const prepared = preparePostmarkTestSendRequest(payload, token);
  const response = await fetcher(prepared.url, {
    method: prepared.method,
    headers: prepared.headers,
    body: JSON.stringify(prepared.body),
  });

  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message = redactProviderError(body.Message || body.ErrorCode || response.statusText);
    return { ok: false, reason: "provider_error", message };
  }

  const providerMessageId = typeof body.MessageID === "string" ? body.MessageID.trim() : "";
  if (!providerMessageId) {
    return {
      ok: false,
      reason: "provider_error",
      message: "Postmark accepted the request but did not return a message id.",
    };
  }

  return {
    ok: true,
    provider: CLIENT_EMAIL_POSTMARK_PROVIDER,
    providerMessageId,
  };
}
