import {
  CHECKOUT_UNAVAILABLE_EN,
  CHECKOUT_UNAVAILABLE_FR,
  checkoutClientMessages,
} from "./checkout-api-messages.ts";

export type CheckoutApiEnvelope<TData = unknown> = {
  ok?: boolean;
  error?: string;
  code?: string;
  message_fr?: string;
  message_en?: string;
  redirect_path?: string | null;
  handoff_type?: string | null;
  login_path?: string | null;
  data?: TData;
};

export type ParsedCheckoutApiResponse<TData = unknown> = {
  ok: boolean;
  status: number;
  payload: CheckoutApiEnvelope<TData> | null;
  data: TData | null;
  clientMessageFr: string;
  clientMessageEn: string;
  parseError: boolean;
};

function looksLikeJson(contentType: string, raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (contentType.includes("application/json")) return true;
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export async function parseCheckoutApiResponse<TData = unknown>(
  response: Response,
  fallback?: { messageFr?: string; messageEn?: string },
): Promise<ParsedCheckoutApiResponse<TData>> {
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  const unavailable = checkoutClientMessages(fallback);

  if (!raw.trim() || !looksLikeJson(contentType, raw)) {
    console.error("[commercial/checkout] Non-JSON API response", {
      status,
      contentType,
      bodyLength: raw.length,
    });
    return {
      ok: false,
      status,
      payload: null,
      data: null,
      clientMessageFr: unavailable.messageFr,
      clientMessageEn: unavailable.messageEn,
      parseError: true,
    };
  }

  try {
    const payload = JSON.parse(raw) as CheckoutApiEnvelope<TData>;
    const messages = checkoutClientMessages({
      messageFr: payload.message_fr ?? payload.error,
      messageEn: payload.message_en ?? payload.error,
      fallbackFr: fallback?.messageFr,
      fallbackEn: fallback?.messageEn,
    });
    const ok = response.ok && payload.ok !== false;
    return {
      ok,
      status,
      payload,
      data: (payload.data ?? null) as TData | null,
      clientMessageFr: messages.messageFr,
      clientMessageEn: messages.messageEn,
      parseError: false,
    };
  } catch (error) {
    console.error("[commercial/checkout] Failed to parse API JSON", {
      status,
      contentType,
      error,
    });
    return {
      ok: false,
      status,
      payload: null,
      data: null,
      clientMessageFr: unavailable.messageFr,
      clientMessageEn: unavailable.messageEn,
      parseError: true,
    };
  }
}
