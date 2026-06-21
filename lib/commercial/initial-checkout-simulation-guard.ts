import {
  ISOLATED_CHECKOUT_ALLOWED_REF,
  readServerSupabaseProjectRef,
} from "./server-supabase-ref.ts";
import {
  isSimulatedCheckoutEnabled,
  simulatedCheckoutEmailAllowlist,
} from "./simulated-checkout-guard.ts";

export const INITIAL_CHECKOUT_ISOLATED_TEST_CONFIRM_VALUE = "isolated-test-only";
export const FICTIONAL_CHECKOUT_EMAIL_DOMAIN = "@example.invalid";

export type InitialCheckoutSimulationDenyReason =
  | "isolated_ref_required"
  | "isolated_test_confirm_required"
  | "simulated_checkout_disabled"
  | "fictional_email_required"
  | "simulated_checkout_allowlist_empty"
  | "simulated_checkout_email_not_allowlisted"
  | "invalid_email";

export type InitialCheckoutSimulationGuardResult =
  | { ok: true }
  | { ok: false; reason: InitialCheckoutSimulationDenyReason };

export type InitialCheckoutSimulationAvailability = {
  simulationAvailable: boolean;
  simulationUnavailableReason: string | null;
};

export function isFictionalCheckoutEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(FICTIONAL_CHECKOUT_EMAIL_DOMAIN);
}

export function isInitialCheckoutIsolatedTestConfirmed(env: NodeJS.ProcessEnv = process.env) {
  return readString(env.SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM) === INITIAL_CHECKOUT_ISOLATED_TEST_CONFIRM_VALUE;
}

export function isInitialCheckoutServerRefAllowed(env: NodeJS.ProcessEnv = process.env) {
  const ref = readServerSupabaseProjectRef(env);
  return ref === ISOLATED_CHECKOUT_ALLOWED_REF;
}

export function initialCheckoutSimulationApiCode(reason: InitialCheckoutSimulationDenyReason) {
  if (
    reason === "isolated_ref_required"
    || reason === "isolated_test_confirm_required"
    || reason === "fictional_email_required"
  ) {
    return "simulated_checkout_forbidden" as const;
  }
  return "simulation_unavailable" as const;
}

export function initialCheckoutSimulationClientMessages(reason: InitialCheckoutSimulationDenyReason) {
  switch (reason) {
    case "fictional_email_required":
      return {
        messageFr: "L'activation de test n'est disponible que pour des adresses fictives de test.",
        messageEn: "Test activation is only available for fictional test email addresses.",
      };
    case "simulated_checkout_email_not_allowlisted":
      return {
        messageFr: "L'activation de test n'est pas disponible pour cette adresse e-mail.",
        messageEn: "Test activation is not available for this email address.",
      };
    case "invalid_email":
      return {
        messageFr: "Adresse e-mail invalide.",
        messageEn: "Invalid email address.",
      };
    default:
      return {
        messageFr: "L'activation de test est temporairement indisponible.",
        messageEn: "Test activation is temporarily unavailable.",
      };
  }
}

export function canUseInitialCheckoutSimulation(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): InitialCheckoutSimulationGuardResult {
  if (!isInitialCheckoutServerRefAllowed(env)) {
    return { ok: false as const, reason: "isolated_ref_required" };
  }
  if (!isInitialCheckoutIsolatedTestConfirmed(env)) {
    return { ok: false as const, reason: "isolated_test_confirm_required" };
  }
  if (!isSimulatedCheckoutEnabled(env)) {
    return { ok: false as const, reason: "simulated_checkout_disabled" };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { ok: false as const, reason: "invalid_email" };
  }
  if (!isFictionalCheckoutEmail(normalizedEmail)) {
    return { ok: false as const, reason: "fictional_email_required" };
  }

  const allowlist = simulatedCheckoutEmailAllowlist(env);
  if (allowlist.size === 0) {
    return { ok: false as const, reason: "simulated_checkout_allowlist_empty" };
  }
  if (!allowlist.has(normalizedEmail)) {
    return { ok: false as const, reason: "simulated_checkout_email_not_allowlisted" };
  }

  return { ok: true as const };
}

export function projectInitialCheckoutSimulationAvailability(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): InitialCheckoutSimulationAvailability {
  const baseGuard = canUseInitialCheckoutSimulation("", env);
  if (
    baseGuard.ok === false
    && baseGuard.reason !== "invalid_email"
    && baseGuard.reason !== "fictional_email_required"
    && baseGuard.reason !== "simulated_checkout_email_not_allowlisted"
  ) {
    return {
      simulationAvailable: false,
      simulationUnavailableReason: baseGuard.reason,
    };
  }

  const normalizedEmail = readString(email).trim().toLowerCase();
  if (!normalizedEmail) {
    return {
      simulationAvailable: false,
      simulationUnavailableReason: null,
    };
  }

  const guard = canUseInitialCheckoutSimulation(normalizedEmail, env);
  if (!guard.ok) {
    return {
      simulationAvailable: false,
      simulationUnavailableReason: guard.reason,
    };
  }

  return {
    simulationAvailable: true,
    simulationUnavailableReason: null,
  };
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}
