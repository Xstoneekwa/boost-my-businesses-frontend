import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripeClient } from "./stripe-client.ts";

type Row = Record<string, unknown>;

export const TENANT_PAYMENT_METHOD_SYNCABLE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function readPaymentMethodId(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return readString(value);
  if (typeof value === "object" && value !== null) {
    return readString((value as Row).id);
  }
  return "";
}

export function readCustomerDefaultPaymentMethodId(customer: Stripe.Customer | Stripe.DeletedCustomer) {
  if (customer.deleted) return "";
  const defaultPm = customer.invoice_settings?.default_payment_method;
  return readPaymentMethodId(defaultPm);
}

export function customerDefaultPaymentMethodChanged(event: Stripe.Event) {
  if (event.type !== "customer.updated") return false;
  const previous = event.data.previous_attributes as Row | undefined;
  if (!previous || typeof previous !== "object") return false;
  const invoiceSettings = previous.invoice_settings;
  if (!invoiceSettings || typeof invoiceSettings !== "object") return false;
  return "default_payment_method" in (invoiceSettings as Row);
}

export async function loadBillingProfileByStripeCustomerId(
  supabase: SupabaseClient,
  stripeCustomerId: string,
) {
  const { data } = await supabase
    .from("commercial_stripe_billing_profiles")
    .select("client_id,stripe_customer_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle<Row>();
  if (!data?.client_id) return null;
  return {
    clientId: readString(data.client_id),
    stripeCustomerId: readString(data.stripe_customer_id),
  };
}

export async function loadTenantStripeSubscriptionIds(
  supabase: SupabaseClient,
  clientId: string,
) {
  const { data } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("stripe_subscription_id,status")
    .eq("client_id", clientId)
    .limit(100);

  if (!Array.isArray(data)) return [] as string[];
  return data
    .filter((row) => TENANT_PAYMENT_METHOD_SYNCABLE_SUBSCRIPTION_STATUSES.has(readString(row.status).toLowerCase()))
    .map((row) => readString(row.stripe_subscription_id))
    .filter(Boolean);
}

export type TenantPaymentMethodSyncResult = {
  ok: true;
  code: "synced" | "noop_already_applied" | "noop_no_default_payment_method" | "noop_no_subscriptions";
  clientId: string;
  stripeCustomerId: string;
  paymentMethodId: string;
  updatedSubscriptionCount: number;
  skippedSubscriptionCount: number;
} | {
  ok: false;
  code:
    | "customer_deleted"
    | "stripe_customer_unknown"
    | "payment_method_missing"
    | "payment_method_foreign"
    | "payment_method_not_attached";
  retryable?: boolean;
};

export async function syncTenantDefaultPaymentMethodToSubscriptions(input: {
  supabase: SupabaseClient;
  stripeCustomerId: string;
  customer?: Stripe.Customer | Stripe.DeletedCustomer;
  stripe?: Stripe;
  env?: NodeJS.ProcessEnv;
}): Promise<TenantPaymentMethodSyncResult> {
  const stripeCustomerId = readString(input.stripeCustomerId);
  if (!stripeCustomerId) {
    return { ok: false, code: "stripe_customer_unknown" };
  }

  const profile = await loadBillingProfileByStripeCustomerId(input.supabase, stripeCustomerId);
  if (!profile) {
    return { ok: false, code: "stripe_customer_unknown" };
  }

  const stripe = input.stripe ?? getStripeClient(input.env);
  const customer = input.customer ?? await stripe.customers.retrieve(stripeCustomerId);
  if (customer.deleted) {
    return { ok: false, code: "customer_deleted" };
  }

  const paymentMethodId = readCustomerDefaultPaymentMethodId(customer);
  if (!paymentMethodId) {
    return {
      ok: true,
      code: "noop_no_default_payment_method",
      clientId: profile.clientId,
      stripeCustomerId,
      paymentMethodId: "",
      updatedSubscriptionCount: 0,
      skippedSubscriptionCount: 0,
    };
  }

  const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
  const paymentMethodCustomerId = readString(paymentMethod.customer);
  if (!paymentMethodCustomerId) {
    return { ok: false, code: "payment_method_not_attached" };
  }
  if (paymentMethodCustomerId !== stripeCustomerId) {
    return { ok: false, code: "payment_method_foreign" };
  }

  const subscriptionIds = await loadTenantStripeSubscriptionIds(input.supabase, profile.clientId);
  if (!subscriptionIds.length) {
    return {
      ok: true,
      code: "noop_no_subscriptions",
      clientId: profile.clientId,
      stripeCustomerId,
      paymentMethodId,
      updatedSubscriptionCount: 0,
      skippedSubscriptionCount: 0,
    };
  }

  let updatedSubscriptionCount = 0;
  let skippedSubscriptionCount = 0;

  for (const subscriptionId of subscriptionIds) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const status = readString(subscription.status).toLowerCase();
    if (!TENANT_PAYMENT_METHOD_SYNCABLE_SUBSCRIPTION_STATUSES.has(status)) {
      skippedSubscriptionCount += 1;
      continue;
    }

    const currentDefault = readPaymentMethodId(subscription.default_payment_method);
    if (currentDefault === paymentMethodId) {
      skippedSubscriptionCount += 1;
      continue;
    }

    await stripe.subscriptions.update(subscriptionId, {
      default_payment_method: paymentMethodId,
    });
    updatedSubscriptionCount += 1;
  }

  if (updatedSubscriptionCount === 0) {
    return {
      ok: true,
      code: "noop_already_applied",
      clientId: profile.clientId,
      stripeCustomerId,
      paymentMethodId,
      updatedSubscriptionCount: 0,
      skippedSubscriptionCount,
    };
  }

  return {
    ok: true,
    code: "synced",
    clientId: profile.clientId,
    stripeCustomerId,
    paymentMethodId,
    updatedSubscriptionCount,
    skippedSubscriptionCount,
  };
}

export function buildTenantPaymentMethodSyncMetadataSafe(result: TenantPaymentMethodSyncResult) {
  if (!result.ok) {
    return {
      tenant_payment_method_sync: result.code,
    };
  }
  return {
    tenant_payment_method_sync: result.code,
    updated_subscription_count: result.updatedSubscriptionCount,
    skipped_subscription_count: result.skippedSubscriptionCount,
  };
}
