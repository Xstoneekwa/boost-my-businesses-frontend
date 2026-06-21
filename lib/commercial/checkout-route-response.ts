import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { CHECKOUT_UNAVAILABLE_EN, CHECKOUT_UNAVAILABLE_FR, checkoutClientMessages } from "./checkout-api-messages";

export function checkoutActivationError(
  status: number,
  code: string,
  input?: {
    messageFr?: string;
    messageEn?: string;
    redirectPath?: string | null;
    handoff?: { type: string; redirectPath?: string; loginPath?: string };
  },
) {
  const messages = checkoutClientMessages({
    messageFr: input?.messageFr,
    messageEn: input?.messageEn,
  });
  return jsonError(messages.messageFr, status, {
    code,
    message_fr: messages.messageFr,
    message_en: messages.messageEn,
    redirect_path: input?.redirectPath ?? null,
    handoff_type: input?.handoff?.type ?? null,
    login_path: input?.handoff?.loginPath ?? null,
  });
}

export function checkoutActivationUnexpectedError(error: unknown) {
  console.error("[commercial/checkout/simulated/activate] Unexpected error", error);
  return checkoutActivationError(500, "activation_failed", {
    messageFr: CHECKOUT_UNAVAILABLE_FR,
    messageEn: CHECKOUT_UNAVAILABLE_EN,
  });
}

export { jsonOk };
