import type { PublicCheckoutLang } from "./public-checkout-lang.ts";

type CopyPair = { fr: string; en: string };

function pick(lang: PublicCheckoutLang, copy: CopyPair) {
  return lang === "en" ? copy.en : copy.fr;
}

export const PUBLIC_CHECKOUT_COPY = {
  paymentCta: { fr: "Confirmer le paiement", en: "Confirm payment" },
  paymentPreparing: { fr: "Préparation du paiement…", en: "Preparing payment…" },
  checkoutSummaryTitle: { fr: "Récapitulatif", en: "Order summary" },
  successTitle: { fr: "Paiement reçu", en: "Payment received" },
  successWaiting: {
    fr: "Nous confirmons votre commande. Merci de patienter quelques instants.",
    en: "We are confirming your order. Please wait a moment.",
  },
  successReady: {
    fr: "Votre compte est prêt. Connectez-vous pour continuer.",
    en: "Your account is ready. Sign in to continue.",
  },
  successPending: {
    fr: "Votre paiement est en cours de confirmation. Cette page se mettra à jour automatiquement.",
    en: "Your payment is being confirmed. This page will update automatically.",
  },
  retryCheck: { fr: "Réessayer", en: "Try again" },
  cancelTitle: { fr: "Paiement annulé", en: "Payment cancelled" },
  cancelBody: {
    fr: "Aucun paiement n'a été effectué. Vous pouvez revenir au tarif et réessayer quand vous le souhaitez.",
    en: "No payment was completed. You can return to pricing and try again whenever you are ready.",
  },
  cancelReturn: { fr: "Retour au tarif", en: "Back to pricing" },
  simulatedBanner: {
    fr: "Simulation interne — aucun paiement ne sera prélevé.",
    en: "Internal simulation — no payment will be charged.",
  },
} as const satisfies Record<string, CopyPair>;

export function publicCheckoutCopy(
  lang: PublicCheckoutLang,
  key: keyof typeof PUBLIC_CHECKOUT_COPY,
) {
  return pick(lang, PUBLIC_CHECKOUT_COPY[key]);
}
