import type Stripe from "stripe";
import { COMMERCIAL_CANCEL_CONTRACT } from "./account-lifecycle-cancel-contract.ts";
import { getStripeClient, setStripeClientForTests } from "./stripe/stripe-client.ts";

export type AccountLifecycleStripeGateway = {
  pauseCollectionVoid: (subscriptionId: string, idempotencyKey: string) => Promise<{ billingPaused: true }>;
  resumeCollection: (subscriptionId: string, idempotencyKey: string) => Promise<{ billingPaused: false }>;
  cancelSubscriptionImmediately: (subscriptionId: string, idempotencyKey: string) => Promise<{ status: string }>;
};

export function createAccountLifecycleStripeGateway(stripe: Stripe): AccountLifecycleStripeGateway {
  return {
    async pauseCollectionVoid(subscriptionId, idempotencyKey) {
      await stripe.subscriptions.update(
        subscriptionId,
        { pause_collection: { behavior: "void" } },
        { idempotencyKey },
      );
      return { billingPaused: true };
    },
    async resumeCollection(subscriptionId, idempotencyKey) {
      await stripe.subscriptions.update(
        subscriptionId,
        { pause_collection: "" },
        { idempotencyKey },
      );
      return { billingPaused: false };
    },
    async cancelSubscriptionImmediately(subscriptionId, idempotencyKey) {
      const sub = await stripe.subscriptions.cancel(
        subscriptionId,
        COMMERCIAL_CANCEL_CONTRACT.stripeCancelParams,
        { idempotencyKey },
      );
      return { status: sub.status };
    },
  };
}

let gatewayOverride: AccountLifecycleStripeGateway | null = null;

export function setAccountLifecycleStripeGatewayForTests(gateway: AccountLifecycleStripeGateway | null) {
  gatewayOverride = gateway;
}

export function getAccountLifecycleStripeGateway(env: NodeJS.ProcessEnv = process.env): AccountLifecycleStripeGateway {
  if (gatewayOverride) return gatewayOverride;
  return createAccountLifecycleStripeGateway(getStripeClient(env));
}

export { setStripeClientForTests };
