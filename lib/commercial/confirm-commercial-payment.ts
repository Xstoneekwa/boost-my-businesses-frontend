import type { CheckoutContext } from "./checkout-context.ts";
import {
  canUseInitialCheckoutSimulation,
  initialCheckoutSimulationApiCode,
  initialCheckoutSimulationClientMessages,
  type InitialCheckoutSimulationDenyReason,
} from "./initial-checkout-simulation-guard.ts";

export type PaymentProvider = "simulated" | "paddle";

export type ConfirmCommercialPaymentInput = {
  provider: PaymentProvider;
  purchaserEmail: string;
  amountDueCents: number;
  idempotencyKey: string;
  checkoutContext: CheckoutContext;
  env?: NodeJS.ProcessEnv;
};

export type ConfirmCommercialPaymentSuccess = {
  ok: true;
  paymentProvider: PaymentProvider;
  paymentStatus: "simulated_confirmed" | "confirmed";
  confirmedAt: string;
  idempotencyKey: string;
};

export type ConfirmCommercialPaymentFailureCode =
  | "provider_not_configured"
  | "simulated_checkout_forbidden"
  | "simulation_unavailable"
  | "unsupported_checkout_context";

export type ConfirmCommercialPaymentFailure = {
  ok: false;
  code: ConfirmCommercialPaymentFailureCode;
  reason: InitialCheckoutSimulationDenyReason | "provider_not_configured" | "unsupported_checkout_context";
  messageFr: string;
  messageEn: string;
};

export type ConfirmCommercialPaymentResult =
  | ConfirmCommercialPaymentSuccess
  | ConfirmCommercialPaymentFailure;

export function confirmCommercialPayment(
  input: ConfirmCommercialPaymentInput,
): ConfirmCommercialPaymentResult {
  const env = input.env ?? process.env;
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    return failureFromReason("simulated_checkout_disabled");
  }

  if (input.provider === "paddle") {
    return {
      ok: false,
      code: "provider_not_configured",
      reason: "provider_not_configured",
      messageFr: "Le paiement Paddle n'est pas encore configuré.",
      messageEn: "Paddle payment is not configured yet.",
    };
  }

  if (input.checkoutContext !== "public_new_workspace") {
    return {
      ok: false,
      code: "unsupported_checkout_context",
      reason: "unsupported_checkout_context",
      messageFr: "Cette confirmation de paiement ne s'applique qu'au premier checkout public.",
      messageEn: "This payment confirmation only applies to public first checkout.",
    };
  }

  const guard = canUseInitialCheckoutSimulation(input.purchaserEmail, env);
  if (!guard.ok) {
    return failureFromReason(guard.reason);
  }

  return {
    ok: true,
    paymentProvider: "simulated",
    paymentStatus: "simulated_confirmed",
    confirmedAt: new Date().toISOString(),
    idempotencyKey,
  };
}

function failureFromReason(reason: InitialCheckoutSimulationDenyReason): ConfirmCommercialPaymentFailure {
  const messages = initialCheckoutSimulationClientMessages(reason);
  return {
    ok: false,
    code: initialCheckoutSimulationApiCode(reason),
    reason,
    messageFr: messages.messageFr,
    messageEn: messages.messageEn,
  };
}
