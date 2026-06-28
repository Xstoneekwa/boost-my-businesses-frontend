import assert from "node:assert/strict";
import test from "node:test";

import { resolveCommercialCheckoutActivationState } from "./commercial-checkout-form-state.ts";
import { withInitialCheckoutAllowlist } from "./initial-checkout-test-env.ts";
import { projectInitialCheckoutSimulationAvailability } from "./initial-checkout-simulation-guard.ts";
import { initialCheckoutSimulationClientMessages } from "./initial-checkout-simulation-guard.ts";

const ALLOWED_EMAIL = "growth_checkout_test@example.invalid";
const BASE_ENV = withInitialCheckoutAllowlist([ALLOWED_EMAIL]);
const VALID_PASSWORD = "valid-password-12";

function publicCheckoutState(overrides: Partial<Parameters<typeof resolveCommercialCheckoutActivationState>[0]> = {}) {
  return resolveCommercialCheckoutActivationState({
    isPublicCheckout: true,
    lang: "fr",
    loading: false,
    quoteLoading: false,
    hasQuote: true,
    activationAvailable: true,
    activationMessageFr: null,
    activationMessageEn: null,
    email: ALLOWED_EMAIL,
    password: VALID_PASSWORD,
    passwordConfirmation: VALID_PASSWORD,
    ...overrides,
  });
}

test("Growth + Aucun outreach + allowlisted fictional email + matching passwords enables CTA", () => {
  const availability = projectInitialCheckoutSimulationAvailability(ALLOWED_EMAIL, BASE_ENV);
  assert.equal(availability.simulationAvailable, true);
  const messages = availability.simulationUnavailableReason
    ? initialCheckoutSimulationClientMessages(availability.simulationUnavailableReason)
    : null;

  const state = publicCheckoutState({
    activationAvailable: availability.simulationAvailable,
    activationMessageFr: messages?.messageFr ?? null,
    activationMessageEn: messages?.messageEn ?? null,
  });

  assert.equal(state.ctaDisabled, false);
  assert.equal(state.blockers.length, 0);
});

test("password mismatch blocks CTA with clear message", () => {
  const state = publicCheckoutState({
    password: VALID_PASSWORD,
    passwordConfirmation: "different-password-12",
  });

  assert.equal(state.ctaDisabled, true);
  assert.match(state.passwordInlineError, /ne correspondent pas/i);
});

test("password too short blocks CTA with clear message", () => {
  const state = publicCheckoutState({
    password: "short",
    passwordConfirmation: "short",
  });

  assert.equal(state.ctaDisabled, true);
  assert.match(state.passwordInlineError, /12 caract/i);
});

test("Aucun outreach is not a blocker — empty outreach addon is valid", () => {
  const state = publicCheckoutState();
  assert.equal(state.ctaDisabled, false);
  assert.equal(state.blockers.some((blocker) => blocker.code.includes("outreach")), false);
});

test("invalid email format blocks CTA with clear message", () => {
  const state = publicCheckoutState({ email: "not-an-email" });
  assert.equal(state.ctaDisabled, true);
  assert.match(state.emailInlineError, /invalide/i);
});

test("non-fictional email blocks simulation with explicit message", () => {
  const availability = projectInitialCheckoutSimulationAvailability("real@company.com", BASE_ENV);
  assert.equal(availability.simulationAvailable, false);
  const messages = initialCheckoutSimulationClientMessages(availability.simulationUnavailableReason!);

  const state = publicCheckoutState({
    email: "real@company.com",
    activationAvailable: false,
    activationMessageFr: messages.messageFr,
    activationMessageEn: messages.messageEn,
  });

  assert.equal(state.ctaDisabled, true);
  assert.match(state.activationNotice, /adresses fictives/i);
  assert.match(state.emailInlineError, /adresses fictives/i);
});

test("email not allowlisted blocks simulation with non-divulgatory message", () => {
  const availability = projectInitialCheckoutSimulationAvailability("probe@example.invalid", BASE_ENV);
  const messages = initialCheckoutSimulationClientMessages(availability.simulationUnavailableReason!);

  const state = publicCheckoutState({
    email: "probe@example.invalid",
    activationAvailable: false,
    activationMessageFr: messages.messageFr,
    activationMessageEn: messages.messageEn,
  });

  assert.equal(state.ctaDisabled, true);
  assert.match(state.activationNotice, /pas disponible pour cette adresse/i);
});

test("quote loading blocks CTA only while loading", () => {
  const loading = publicCheckoutState({ quoteLoading: true, hasQuote: false, activationAvailable: false });
  assert.equal(loading.ctaDisabled, true);
  assert.equal(loading.blockers.some((blocker) => blocker.code === "quote_loading"), true);

  const ready = publicCheckoutState();
  assert.equal(ready.ctaDisabled, false);
  assert.equal(ready.blockers.some((blocker) => blocker.code === "quote_loading"), false);
});

test("add-account flow keeps outreach-none semantics and uses server activation messages", () => {
  const state = resolveCommercialCheckoutActivationState({
    isPublicCheckout: false,
    lang: "fr",
    loading: false,
    quoteLoading: false,
    hasQuote: true,
    activationAvailable: false,
    activationMessageFr: "L'activation de test est temporairement indisponible.",
    activationMessageEn: "Test activation is temporarily unavailable.",
    email: "",
    password: "",
    passwordConfirmation: "",
  });

  assert.equal(state.ctaDisabled, true);
  assert.match(state.activationNotice, /temporairement indisponible/i);
});

test("plan change context never adds artificial +1 via checkout form state", () => {
  const state = resolveCommercialCheckoutActivationState({
    isPublicCheckout: false,
    lang: "fr",
    loading: false,
    quoteLoading: false,
    hasQuote: true,
    activationAvailable: true,
    activationMessageFr: null,
    activationMessageEn: null,
    email: "",
    password: "",
    passwordConfirmation: "",
  });

  assert.equal(state.ctaDisabled, false);
});

test("existing email conflict message stays non-divulgatory at activation layer", () => {
  const message = "A client workspace already exists for this email address. Sign in to add an account from your workspace.";
  assert.doesNotMatch(message, /@/);
  assert.match(message, /Sign in/i);
});
