export const CHECKOUT_UNAVAILABLE_FR =
  "L'activation de test est temporairement indisponible. Réessayez dans quelques instants.";

export const CHECKOUT_UNAVAILABLE_EN =
  "Test activation is temporarily unavailable. Please try again shortly.";

export const QUOTE_UNAVAILABLE_FR = "Impossible de calculer le devis pour le moment.";
export const QUOTE_UNAVAILABLE_EN = "Could not compute the quote right now.";

export function checkoutClientMessages(input?: {
  messageFr?: string | null;
  messageEn?: string | null;
  fallbackFr?: string;
  fallbackEn?: string;
}) {
  return {
    messageFr: input?.messageFr?.trim() || input?.fallbackFr || CHECKOUT_UNAVAILABLE_FR,
    messageEn: input?.messageEn?.trim() || input?.fallbackEn || CHECKOUT_UNAVAILABLE_EN,
  };
}
