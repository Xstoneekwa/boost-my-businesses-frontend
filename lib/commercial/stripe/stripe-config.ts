export type StripeFoundationErrorCode =
  | "stripe_test_not_configured"
  | "stripe_test_mode_required"
  | "stripe_live_key_rejected"
  | "stripe_livemode_rejected";

export class StripeFoundationError extends Error {
  code: StripeFoundationErrorCode;

  constructor(code: StripeFoundationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type StripeTestConfig = {
  secretKey: string;
  webhookSecret: string | null;
  billingPortalConfigurationId: string | null;
  testCheckoutEnabled: boolean;
};

const TEST_KEY_PREFIXES = ["sk_test_", "rk_test_"] as const;
const LIVE_KEY_PREFIXES = ["sk_live_", "rk_live_"] as const;

export function isStripeTestSecretKey(value: string) {
  const trimmed = value.trim();
  return TEST_KEY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function isStripeLiveSecretKey(value: string) {
  const trimmed = value.trim();
  return LIVE_KEY_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function readStripeTestConfig(env: NodeJS.ProcessEnv = process.env): StripeTestConfig | null {
  const secretKey = String(env.STRIPE_SECRET_KEY ?? "").trim();
  const testCheckoutEnabled = readBooleanFlag(env.STRIPE_TEST_CHECKOUT_ENABLED);
  if (!secretKey || !testCheckoutEnabled) {
    return null;
  }
  if (isStripeLiveSecretKey(secretKey)) {
    throw new StripeFoundationError(
      "stripe_live_key_rejected",
      "Live Stripe secret keys are not allowed in Stripe Test Foundation.",
    );
  }
  if (!isStripeTestSecretKey(secretKey)) {
    throw new StripeFoundationError(
      "stripe_test_mode_required",
      "Stripe Test Foundation requires a test-mode secret key.",
    );
  }
  return {
    secretKey,
    webhookSecret: String(env.STRIPE_WEBHOOK_SECRET ?? "").trim() || null,
    billingPortalConfigurationId: String(env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID ?? "").trim() || null,
    testCheckoutEnabled: true,
  };
}

export function requireStripeTestConfig(env: NodeJS.ProcessEnv = process.env): StripeTestConfig {
  try {
    const config = readStripeTestConfig(env);
    if (!config) {
      throw new StripeFoundationError(
        "stripe_test_not_configured",
        "Stripe Test checkout is not configured.",
      );
    }
    return config;
  } catch (error) {
    if (error instanceof StripeFoundationError) {
      throw error;
    }
    throw new StripeFoundationError(
      "stripe_test_not_configured",
      "Stripe Test checkout is not configured.",
    );
  }
}

export function assertStripeTestLivemode(livemode: boolean) {
  if (livemode) {
    throw new StripeFoundationError(
      "stripe_livemode_rejected",
      "Live-mode Stripe objects are rejected in Stripe Test Foundation.",
    );
  }
}

function readBooleanFlag(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}
