import Stripe from "stripe";
import { requireStripeTestConfig, type StripeTestConfig } from "./stripe-config.ts";

let stripeClientOverride: Stripe | null = null;

export function setStripeClientForTests(client: Stripe | null) {
  stripeClientOverride = client;
}

export function createStripeClient(config: StripeTestConfig) {
  return new Stripe(config.secretKey, {
    typescript: true,
  });
}

export function getStripeClient(env: NodeJS.ProcessEnv = process.env) {
  if (stripeClientOverride) {
    return stripeClientOverride;
  }
  const config = requireStripeTestConfig(env);
  return createStripeClient(config);
}
