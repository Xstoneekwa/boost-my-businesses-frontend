import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canUseInitialCheckoutSimulation,
  initialCheckoutSimulationClientMessages,
  projectInitialCheckoutSimulationAvailability,
  type InitialCheckoutSimulationDenyReason,
} from "./initial-checkout-simulation-guard.ts";
import {
  canUseSimulatedCheckoutForEmail,
  projectSimulatedCheckoutAvailability,
  simulatedCheckoutClientMessages,
  type SimulatedCheckoutGuardReason,
} from "./simulated-checkout-guard.ts";
import {
  evaluateProdTestCheckoutAuthorization,
  prodTestCheckoutClientMessages,
  type ProdTestCheckoutDenyReason,
} from "./prod-test-checkout-authorization.ts";

export type CheckoutSimulationAccessSource =
  | "prod_test_authorization"
  | "isolated_first_purchase"
  | "legacy_allowlist";

export type CheckoutSimulationAvailability = {
  simulationAvailable: boolean;
  simulationUnavailableReason: string | null;
  activationMessageFr: string | null;
  activationMessageEn: string | null;
  accessSource: CheckoutSimulationAccessSource | null;
  prodTestAuthorizationId: string | null;
};

export type CheckoutSimulationAccess = {
  allowed: boolean;
  source: CheckoutSimulationAccessSource | null;
  prodTestAuthorizationId: string | null;
  reason: InitialCheckoutSimulationDenyReason | SimulatedCheckoutGuardReason | ProdTestCheckoutDenyReason | null;
  messageFr: string | null;
  messageEn: string | null;
};

function genericUnavailableMessages() {
  return {
    messageFr: "L'activation de test est temporairement indisponible.",
    messageEn: "Test activation is temporarily unavailable.",
  };
}

export async function evaluateCheckoutSimulationAccess(input: {
  supabase: SupabaseClient;
  email: string | null | undefined;
  flowType: "first_purchase" | "additional_account";
  clientId?: string | null;
  planKey?: string | null;
  billingIntervalMonths?: number | null;
  env?: NodeJS.ProcessEnv;
}): Promise<CheckoutSimulationAccess> {
  const prodTest = await evaluateProdTestCheckoutAuthorization({
    supabase: input.supabase,
    email: input.email,
    flowType: input.flowType,
    clientId: input.clientId,
    planKey: input.planKey,
    billingIntervalMonths: input.billingIntervalMonths,
    env: input.env,
  });

  if (prodTest.ok) {
    return {
      allowed: true,
      source: "prod_test_authorization",
      prodTestAuthorizationId: prodTest.authorization.id,
      reason: null,
      messageFr: null,
      messageEn: null,
    };
  }

  if (prodTest.reason && prodTest.reason !== "not_production_environment" && prodTest.reason !== "authorization_not_found") {
    const messages = prodTestCheckoutClientMessages(prodTest.reason);
    return {
      allowed: false,
      source: null,
      prodTestAuthorizationId: null,
      reason: prodTest.reason,
      messageFr: messages.messageFr,
      messageEn: messages.messageEn,
    };
  }

  if (input.flowType === "first_purchase") {
    const normalizedEmail = typeof input.email === "string" ? input.email.trim() : "";
    if (!normalizedEmail) {
      return {
        allowed: false,
        source: null,
        prodTestAuthorizationId: null,
        reason: null,
        messageFr: null,
        messageEn: null,
      };
    }

    const guard = canUseInitialCheckoutSimulation(normalizedEmail, input.env);
    if (!guard.ok) {
      const messages = initialCheckoutSimulationClientMessages(guard.reason);
      return {
        allowed: false,
        source: null,
        prodTestAuthorizationId: null,
        reason: guard.reason,
        messageFr: messages.messageFr,
        messageEn: messages.messageEn,
      };
    }

    return {
      allowed: true,
      source: "isolated_first_purchase",
      prodTestAuthorizationId: null,
      reason: null,
      messageFr: null,
      messageEn: null,
    };
  }

  const normalizedEmail = typeof input.email === "string" ? input.email.trim() : "";
  if (!normalizedEmail) {
    return {
      allowed: false,
      source: null,
      prodTestAuthorizationId: null,
      reason: null,
      messageFr: null,
      messageEn: null,
    };
  }

  const guard = canUseSimulatedCheckoutForEmail(normalizedEmail, input.env);
  if (!guard.ok) {
    const messages = simulatedCheckoutClientMessages(guard.reason);
    return {
      allowed: false,
      source: null,
      prodTestAuthorizationId: null,
      reason: guard.reason,
      messageFr: messages.messageFr,
      messageEn: messages.messageEn,
    };
  }

  return {
    allowed: true,
    source: "legacy_allowlist",
    prodTestAuthorizationId: null,
    reason: null,
    messageFr: null,
    messageEn: null,
  };
}

export async function projectCheckoutSimulationAvailability(input: {
  supabase: SupabaseClient;
  email: string | null | undefined;
  flowType: "first_purchase" | "additional_account";
  clientId?: string | null;
  planKey?: string | null;
  billingIntervalMonths?: number | null;
  env?: NodeJS.ProcessEnv;
}): Promise<CheckoutSimulationAvailability> {
  const access = await evaluateCheckoutSimulationAccess(input);

  if (access.allowed) {
    return {
      simulationAvailable: true,
      simulationUnavailableReason: null,
      activationMessageFr: null,
      activationMessageEn: null,
      accessSource: access.source,
      prodTestAuthorizationId: access.prodTestAuthorizationId,
    };
  }

  if (!access.reason) {
    return {
      simulationAvailable: false,
      simulationUnavailableReason: null,
      activationMessageFr: null,
      activationMessageEn: null,
      accessSource: null,
      prodTestAuthorizationId: null,
    };
  }

  const messages = access.messageFr && access.messageEn
    ? { messageFr: access.messageFr, messageEn: access.messageEn }
    : genericUnavailableMessages();

  return {
    simulationAvailable: false,
    simulationUnavailableReason: access.reason,
    activationMessageFr: messages.messageFr,
    activationMessageEn: messages.messageEn,
    accessSource: null,
    prodTestAuthorizationId: null,
  };
}

export function projectLegacyAdditionalAccountAvailability(
  email: string | null | undefined,
  env?: NodeJS.ProcessEnv,
) {
  const legacy = projectSimulatedCheckoutAvailability(email, env);
  return {
    simulatedCheckoutEnabled: legacy.simulatedCheckoutEnabled,
    simulatedActivationAvailable: legacy.simulatedActivationAvailable,
    requiresEmail: legacy.requiresEmail,
    activationMessageFr: legacy.messageFr,
    activationMessageEn: legacy.messageEn,
  };
}

export function projectLegacyFirstPurchaseAvailability(
  email: string | null | undefined,
  env?: NodeJS.ProcessEnv,
) {
  return projectInitialCheckoutSimulationAvailability(email, env);
}
