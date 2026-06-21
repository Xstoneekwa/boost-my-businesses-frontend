export const CHECKOUT_PASSWORD_MIN_LENGTH = 12;

export type CheckoutPasswordValidation =
  | { ok: true }
  | { ok: false; code: "password_required" | "password_too_short" | "password_confirmation_required" | "password_mismatch"; messageFr: string; messageEn: string };

export function validatePublicCheckoutPassword(input: {
  password: string;
  passwordConfirmation: string;
}): CheckoutPasswordValidation {
  const password = input.password;
  const passwordConfirmation = input.passwordConfirmation;

  if (!password) {
    return {
      ok: false,
      code: "password_required",
      messageFr: "Le mot de passe est requis.",
      messageEn: "Password is required.",
    };
  }
  if (password.length < CHECKOUT_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      code: "password_too_short",
      messageFr: `Le mot de passe doit contenir au moins ${CHECKOUT_PASSWORD_MIN_LENGTH} caractères.`,
      messageEn: `Password must be at least ${CHECKOUT_PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (!passwordConfirmation) {
    return {
      ok: false,
      code: "password_confirmation_required",
      messageFr: "Veuillez confirmer votre mot de passe.",
      messageEn: "Please confirm your password.",
    };
  }
  if (password !== passwordConfirmation) {
    return {
      ok: false,
      code: "password_mismatch",
      messageFr: "Les mots de passe ne correspondent pas.",
      messageEn: "Passwords do not match.",
    };
  }
  return { ok: true };
}

export function publicCheckoutPasswordRulesFr() {
  return `Minimum ${CHECKOUT_PASSWORD_MIN_LENGTH} caractères.`;
}

export function publicCheckoutPasswordRulesEn() {
  return `At least ${CHECKOUT_PASSWORD_MIN_LENGTH} characters.`;
}
