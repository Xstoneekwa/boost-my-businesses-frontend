export const COMMERCIAL_TEST_MODES = ["simulated", "stripe_test"] as const;

export type CommercialTestMode = typeof COMMERCIAL_TEST_MODES[number];

export const COMMERCIAL_MIGRATION_KINDS = ["simulated_to_stripe_test"] as const;

export type CommercialMigrationKind = typeof COMMERCIAL_MIGRATION_KINDS[number];

export function isCommercialTestMode(value: unknown): value is CommercialTestMode {
  return value === "simulated" || value === "stripe_test";
}

export function isCommercialMigrationKind(value: unknown): value is CommercialMigrationKind {
  return value === "simulated_to_stripe_test";
}

export function assertRealStripeTestMode(input: {
  commercialTestMode: unknown;
  realStripeTestE2E?: boolean;
}) {
  if (!isCommercialTestMode(input.commercialTestMode)) {
    return { ok: false as const, code: "commercial_test_mode_required" as const };
  }
  if (input.commercialTestMode !== "stripe_test") {
    return {
      ok: false as const,
      code: input.realStripeTestE2E
        ? "real_stripe_test_requires_stripe_test_mode" as const
        : "stripe_checkout_requires_stripe_test_mode" as const,
    };
  }
  return { ok: true as const, commercialTestMode: "stripe_test" as const };
}
