export type CommercialCheckoutProvenance =
  | "simulated_checkout"
  | "stripe_test"
  | "stripe_live";

export function resolveCommercialCheckoutProvenance(input: {
  mode: "simulated" | "stripe";
  stripeLivemode?: boolean;
}): CommercialCheckoutProvenance {
  if (input.mode === "simulated") {
    return "simulated_checkout";
  }
  if (input.stripeLivemode) {
    return "stripe_live";
  }
  return "stripe_test";
}

export function isSimulatedCheckoutProvenance(value: unknown): value is "simulated_checkout" {
  return value === "simulated_checkout";
}
