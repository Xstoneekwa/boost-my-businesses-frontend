export function isSimulatedCheckoutEnabled(env: NodeJS.ProcessEnv = process.env) {
  return readBoolean(env.SIMULATED_CHECKOUT_ENABLED);
}

export function simulatedCheckoutEmailAllowlist(env: NodeJS.ProcessEnv = process.env) {
  const raw = readString(env.SIMULATED_CHECKOUT_EMAIL_ALLOWLIST);
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isSimulatedCheckoutEnvironmentAllowed(env: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = readString(env.NODE_ENV).toLowerCase();
  if (nodeEnv !== "production") return true;
  return readBoolean(env.SIMULATED_CHECKOUT_ALLOW_PRODUCTION);
}

export type SimulatedCheckoutGuardReason =
  | "simulated_checkout_disabled"
  | "simulated_checkout_environment_forbidden"
  | "simulated_checkout_allowlist_empty"
  | "simulated_checkout_email_not_allowlisted"
  | "invalid_email";

export function simulatedCheckoutClientMessages(reason: SimulatedCheckoutGuardReason) {
  switch (reason) {
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

export type SimulatedCheckoutGuardResult =
  | { ok: true }
  | { ok: false; reason: SimulatedCheckoutGuardReason };

export function canUseSimulatedCheckoutForEmail(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): SimulatedCheckoutGuardResult {
  if (!isSimulatedCheckoutEnabled(env)) {
    return { ok: false as const, reason: "simulated_checkout_disabled" };
  }
  if (!isSimulatedCheckoutEnvironmentAllowed(env)) {
    return { ok: false as const, reason: "simulated_checkout_environment_forbidden" };
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { ok: false as const, reason: "invalid_email" };
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

export type SimulatedCheckoutAvailabilityProjection = {
  simulatedCheckoutEnabled: boolean;
  simulatedActivationAvailable: boolean;
  requiresEmail: boolean;
  messageFr: string | null;
  messageEn: string | null;
};

export function projectSimulatedCheckoutAvailability(
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): SimulatedCheckoutAvailabilityProjection {
  const featureEnabled = isSimulatedCheckoutEnabled(env) && isSimulatedCheckoutEnvironmentAllowed(env);
  if (!featureEnabled) {
    const messages = simulatedCheckoutClientMessages("simulated_checkout_disabled");
    return {
      simulatedCheckoutEnabled: false,
      simulatedActivationAvailable: false,
      requiresEmail: false,
      messageFr: messages.messageFr,
      messageEn: messages.messageEn,
    };
  }

  const normalizedEmail = readString(email).trim().toLowerCase();
  if (!normalizedEmail) {
    return {
      simulatedCheckoutEnabled: true,
      simulatedActivationAvailable: false,
      requiresEmail: true,
      messageFr: null,
      messageEn: null,
    };
  }

  const guard = canUseSimulatedCheckoutForEmail(normalizedEmail, env);
  if (!guard.ok) {
    const messages = simulatedCheckoutClientMessages(guard.reason);
    return {
      simulatedCheckoutEnabled: true,
      simulatedActivationAvailable: false,
      requiresEmail: false,
      messageFr: messages.messageFr,
      messageEn: messages.messageEn,
    };
  }

  return {
    simulatedCheckoutEnabled: true,
    simulatedActivationAvailable: true,
    requiresEmail: false,
    messageFr: null,
    messageEn: null,
  };
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
