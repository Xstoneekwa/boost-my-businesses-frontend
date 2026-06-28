import { validatePublicCheckoutPassword } from "./checkout-password.ts";

export type CheckoutActivationBlockerCode =
  | "quote_loading"
  | "quote_missing"
  | "activating"
  | "email_required"
  | "email_invalid"
  | "password_invalid"
  | "simulation_unavailable";

export type CheckoutActivationBlocker = {
  code: CheckoutActivationBlockerCode;
  field?: "email" | "password" | "form";
  messageFr: string;
  messageEn: string;
};

const EMAIL_REQUIRED = {
  messageFr: "Indiquez votre adresse e-mail de connexion pour continuer.",
  messageEn: "Enter your login email address to continue.",
};

const EMAIL_INVALID = {
  messageFr: "Adresse e-mail invalide.",
  messageEn: "Invalid email address.",
};

const QUOTE_LOADING = {
  messageFr: "Calcul du devis en cours…",
  messageEn: "Calculating quote…",
};

const QUOTE_MISSING = {
  messageFr: "Le devis n'est pas disponible pour le moment.",
  messageEn: "The quote is not available right now.",
};

const ACTIVATING = {
  messageFr: "Activation en cours…",
  messageEn: "Activation in progress…",
};

export function isCheckoutEmailFormatValid(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const at = normalized.indexOf("@");
  return at > 0 && normalized.includes(".", at + 1);
}

export function resolveCommercialCheckoutActivationState(input: {
  isPublicCheckout: boolean;
  lang: "fr" | "en";
  loading: boolean;
  quoteLoading: boolean;
  hasQuote: boolean;
  activationAvailable: boolean;
  activationMessageFr?: string | null;
  activationMessageEn?: string | null;
  email: string;
  password: string;
  passwordConfirmation: string;
}): {
  ctaDisabled: boolean;
  blockers: CheckoutActivationBlocker[];
  emailInlineError: string;
  activationNotice: string;
  passwordInlineError: string;
} {
  const blockers: CheckoutActivationBlocker[] = [];
  const email = input.email.trim();
  const passwordValidation = validatePublicCheckoutPassword({
    password: input.password,
    passwordConfirmation: input.passwordConfirmation,
  });

  if (input.quoteLoading) {
    blockers.push({ code: "quote_loading", field: "form", ...QUOTE_LOADING });
  } else if (!input.hasQuote) {
    blockers.push({ code: "quote_missing", field: "form", ...QUOTE_MISSING });
  }

  if (input.loading) {
    blockers.push({ code: "activating", field: "form", ...ACTIVATING });
  }

  if (input.isPublicCheckout) {
    if (!email && input.hasQuote && !input.quoteLoading) {
      blockers.push({ code: "email_required", field: "email", ...EMAIL_REQUIRED });
    } else if (email && !isCheckoutEmailFormatValid(email)) {
      blockers.push({ code: "email_invalid", field: "email", ...EMAIL_INVALID });
    }

    if (input.password || input.passwordConfirmation) {
      if (!passwordValidation.ok) {
        blockers.push({
          code: "password_invalid",
          field: "password",
          messageFr: passwordValidation.messageFr,
          messageEn: passwordValidation.messageEn,
        });
      }
    }
  }

  const activationMessageFr = input.activationMessageFr?.trim() ?? "";
  const activationMessageEn = input.activationMessageEn?.trim() ?? "";
  if (
    !input.activationAvailable
    && input.hasQuote
    && !input.quoteLoading
    && (activationMessageFr || activationMessageEn)
  ) {
    blockers.push({
      code: "simulation_unavailable",
      field: input.isPublicCheckout ? "email" : "form",
      messageFr: activationMessageFr || activationMessageEn,
      messageEn: activationMessageEn || activationMessageFr,
    });
  }

  const ctaDisabled = input.loading
    || input.quoteLoading
    || !input.hasQuote
    || !input.activationAvailable
    || (input.isPublicCheckout && !email)
    || (input.isPublicCheckout && email.length > 0 && !isCheckoutEmailFormatValid(email))
    || (input.isPublicCheckout && !passwordValidation.ok);

  const activationNotice = blockers.find((blocker) => blocker.code === "simulation_unavailable");
  const emailBlocker = blockers.find((blocker) => blocker.field === "email" && blocker.code !== "email_required");
  const emailInlineError = emailBlocker
    ? (input.lang === "fr" ? emailBlocker.messageFr : emailBlocker.messageEn)
    : "";
  const passwordBlocker = blockers.find((blocker) => blocker.code === "password_invalid");
  const passwordInlineError = passwordBlocker
    ? (input.lang === "fr" ? passwordBlocker.messageFr : passwordBlocker.messageEn)
    : "";

  return {
    ctaDisabled,
    blockers: blockers.filter((blocker) => blocker.code !== "activating" || input.loading),
    emailInlineError,
    activationNotice: activationNotice
      ? (input.lang === "fr" ? activationNotice.messageFr : activationNotice.messageEn)
      : "",
    passwordInlineError,
  };
}
