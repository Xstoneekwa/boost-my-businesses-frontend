import {
  canUseSimulatedCheckoutForEmail,
  isSimulatedCheckoutEnabled,
  isSimulatedCheckoutEnvironmentAllowed,
  simulatedCheckoutClientMessages,
  type SimulatedCheckoutGuardReason,
} from "./simulated-checkout-guard.ts";

export type PlanChangeActivationGuardReason =
  | SimulatedCheckoutGuardReason
  | "payment_required"
  | "simulated_plan_change_disabled";

export function isSimulatedPlanChangeActivationEnabled(env: NodeJS.ProcessEnv = process.env) {
  const explicit = readString(env.SIMULATED_PLAN_CHANGE_ACTIVATION_ENABLED);
  if (explicit) return readBoolean(explicit);
  return isSimulatedCheckoutEnabled(env);
}

export function canUseSimulatedPlanChangeActivation(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!isSimulatedPlanChangeActivationEnabled(env)) {
    return { ok: false as const, reason: "simulated_plan_change_disabled" as const };
  }
  return canUseSimulatedCheckoutForEmail(email, env);
}

export function evaluatePlanChangeActivation(input: {
  amountDueCents: number;
  actorEmail: string;
  paymentStatus?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const paymentStatus = readString(input.paymentStatus).toLowerCase();

  if (input.amountDueCents <= 0) {
    return { ok: true as const, mode: "zero_due" as const };
  }

  if (paymentStatus === "confirmed" || paymentStatus === "provider_confirmed") {
    return { ok: true as const, mode: "payment_confirmed" as const };
  }

  const simulated = canUseSimulatedPlanChangeActivation(input.actorEmail, env);
  if (!simulated.ok) {
    return { ok: false as const, reason: "payment_required" as const, guardReason: simulated.reason };
  }

  if (!isSimulatedCheckoutEnvironmentAllowed(env)) {
    return { ok: false as const, reason: "payment_required" as const, guardReason: "simulated_checkout_environment_forbidden" as const };
  }

  return { ok: true as const, mode: "simulated_test" as const };
}

export function planChangeActivationClientMessages(reason: PlanChangeActivationGuardReason) {
  if (reason === "payment_required") {
    return {
      messageFr: "Un paiement est requis avant d'activer ce changement de formule.",
      messageEn: "Payment is required before activating this plan change.",
    };
  }
  if (reason === "simulated_plan_change_disabled") {
    return {
      messageFr: "L'activation simulée du changement de formule est indisponible.",
      messageEn: "Simulated plan change activation is unavailable.",
    };
  }
  return simulatedCheckoutClientMessages(reason);
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = readString(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}
