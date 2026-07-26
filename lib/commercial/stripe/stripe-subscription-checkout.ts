import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { buildCommercialQuote } from "../pricing.ts";
import {
  requireCheckoutSignupCredentialSecret,
  storeCheckoutPendingSignupCredential,
  validateStripeFirstPurchaseSignupPassword,
} from "../checkout-pending-signup-credential.ts";
import {
  OUTREACH_ADDONS,
  isBillingIntervalMonths,
  isOutreachAddonKey,
  isPlanKey,
  type BillingIntervalMonths,
  type CheckoutFlowType,
  type OutreachAddonKey,
  type PlanKey,
} from "../catalog.ts";
import { evaluateCheckoutSimulationAccess } from "../checkout-simulation-access.ts";
import { requireStripeTestConfig, StripeFoundationError } from "./stripe-config.ts";
import { getStripeClient } from "./stripe-client.ts";
import {
  loadStripeComponentPriceCatalogRow,
  resolveStripeProductIdForComponent,
} from "./stripe-component-price-resolver.ts";
import {
  createInternalCheckoutSessionPending,
  createStripeCheckoutAttempt,
} from "./stripe-checkout-attempts.ts";
import { buildSafeStripeMetadata, isValidStripePriceId, rejectUnsafeStripeMetadataKeys } from "./stripe-catalog.ts";
import { isStripeTestFoundationReady, getStripeTestReadiness } from "./stripe-readiness.ts";
import {
  componentsFromPricingSnapshot,
  inferCommercialMode,
  isPublicCatalogComponent,
  productKeyForOutreach,
  publicCatalogAmountCents,
  validateEntitlementBillingBinding,
  type CommercialMode,
  type StripeBillingComponent,
} from "./stripe-per-entitlement-billing.ts";
import { upsertStripeBillingProfile } from "./stripe-subscription-projection.ts";

export type CreateStripeSubscriptionCheckoutInput = {
  commercialMode?: string | null;
  planKey?: string | null;
  packageKey?: string | null;
  billingIntervalMonths: number;
  outreachAddonKey?: string | null;
  purchaserEmail: string;
  flowType: CheckoutFlowType;
  idempotencyKey: string;
  clientId?: string | null;
  authUserId?: string | null;
  password?: string | null;
  passwordConfirmation?: string | null;
  successUrl: string;
  cancelUrl: string;
  allowedOrigins?: string[];
  stripe?: Stripe;
};

export type CreateStripeSubscriptionCheckoutResult =
  | { ok: true; checkoutUrl: string; internalAttemptId: string; internalCheckoutSessionId: string }
  | { ok: false; status: number; code: string; messageEn: string };

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function normalizeCommercialRequest(input: CreateStripeSubscriptionCheckoutInput):
  | {
    ok: true;
    commercialMode: CommercialMode;
    planKey: PlanKey | null;
    billingIntervalMonths: BillingIntervalMonths;
    outreachAddonKey: OutreachAddonKey | null;
  }
  | { ok: false; status: number; code: string; messageEn: string } {
  const commercialMode = inferCommercialMode({
    planKey: input.planKey ?? input.packageKey ?? null,
    outreachAddonKey: input.outreachAddonKey,
    explicitMode: input.commercialMode,
  });
  if (!commercialMode) {
    return { ok: false, status: 400, code: "commercial_mode_invalid", messageEn: "Invalid commercial mode." };
  }

  const billingIntervalMonths = Number(input.billingIntervalMonths);
  if (!isBillingIntervalMonths(billingIntervalMonths)) {
    return { ok: false, status: 400, code: "invalid_billing_interval", messageEn: "Invalid billing interval." };
  }

  const packageInput = readString(input.packageKey ?? input.planKey);
  const planKey = packageInput ? (isPlanKey(packageInput) ? packageInput : null) : null;
  const outreachInput = readString(input.outreachAddonKey);
  const outreachAddonKey = outreachInput ? (isOutreachAddonKey(outreachInput) ? outreachInput : null) : null;

  if (packageInput && !planKey) {
    return { ok: false, status: 400, code: "invalid_package", messageEn: "Invalid package selection." };
  }
  if (outreachInput && !outreachAddonKey) {
    return { ok: false, status: 400, code: "invalid_outreach", messageEn: "Invalid outreach selection." };
  }
  if (commercialMode === "full_cycle" && !planKey) {
    return { ok: false, status: 400, code: "full_cycle_package_required", messageEn: "Full cycle requires one package." };
  }
  if (commercialMode === "outreach_only" && planKey) {
    return { ok: false, status: 400, code: "outreach_only_package_forbidden", messageEn: "Outreach-only cannot include a package." };
  }
  if (commercialMode === "outreach_only" && !outreachAddonKey) {
    return { ok: false, status: 400, code: "outreach_only_outreach_required", messageEn: "Outreach-only requires one outreach product." };
  }

  return { ok: true, commercialMode, planKey, billingIntervalMonths, outreachAddonKey };
}

function buildOutreachOnlyComponents(input: {
  outreachAddonKey: OutreachAddonKey;
  billingIntervalMonths: BillingIntervalMonths;
}): StripeBillingComponent[] {
  return [{
    componentKind: "outreach",
    productKey: productKeyForOutreach(input.outreachAddonKey),
    packageKey: null,
    outreachKey: input.outreachAddonKey,
    billingIntervalMonths: input.billingIntervalMonths,
    amountCents: publicCatalogAmountCents("outreach", input.outreachAddonKey, input.billingIntervalMonths),
    currency: "eur",
  }];
}

function buildOutreachOnlyCommercialQuote(input: {
  outreachAddonKey: OutreachAddonKey;
  billingIntervalMonths: BillingIntervalMonths;
}) {
  const addon = OUTREACH_ADDONS[input.outreachAddonKey];
  const amountCents = publicCatalogAmountCents("outreach", input.outreachAddonKey, input.billingIntervalMonths);
  const line = {
    lineKey: "outreach",
    label: addon.displayNameFr,
    baseMonthlyPriceCents: addon.baseMonthlyPriceCents,
    discountPercent: 0,
    discountType: "none",
    monthlyDiscountedPriceCents: Math.round(amountCents / input.billingIntervalMonths),
    billingIntervalMonths: input.billingIntervalMonths,
    billingPeriodTotalCents: amountCents,
  };
  return {
    planKey: null,
    billingIntervalMonths: input.billingIntervalMonths,
    outreachAddonKey: input.outreachAddonKey,
    billableAccountCount: 1,
    termDiscountPercent: 0,
    agencyDiscountPercent: 0,
    appliedDiscountPercent: 0,
    appliedDiscountType: "none",
    packLine: {
      lineKey: "pack",
      label: "No package",
      baseMonthlyPriceCents: 0,
      discountPercent: 0,
      discountType: "none",
      monthlyDiscountedPriceCents: 0,
      billingIntervalMonths: input.billingIntervalMonths,
      billingPeriodTotalCents: 0,
    },
    outreachLine: line,
    totalPeriodCents: amountCents,
    catalogSnapshot: {},
    pricingSnapshot: {
      version: `outreach-only:${input.outreachAddonKey}:${input.billingIntervalMonths}`,
      planKey: null,
      billingIntervalMonths: input.billingIntervalMonths,
      outreachAddonKey: input.outreachAddonKey,
      packPeriodTotalCents: 0,
      outreachPeriodTotalCents: amountCents,
      totalPeriodCents: amountCents,
    },
  };
}

function validateCheckoutUrl(url: string, allowedOrigins: string[]) {
  try {
    const parsed = new URL(url);
    return allowedOrigins.includes(parsed.origin);
  } catch {
    return false;
  }
}

async function resolveStripeCustomer(
  supabase: SupabaseClient,
  input: {
    stripe: Stripe;
    clientId?: string | null;
    email: string;
    idempotencyKey: string;
  },
) {
  if (!input.clientId) return { ok: true as const, customerId: null };
  const { data: existing, error } = await supabase
    .from("commercial_stripe_billing_profiles")
    .select("stripe_customer_id")
    .eq("client_id", input.clientId)
    .eq("livemode", false)
    .maybeSingle<Record<string, unknown>>();
  if (error) return { ok: false as const, code: "stripe_customer_lookup_failed" as const };
  const existingId = readString(existing?.stripe_customer_id);
  if (existingId) return { ok: true as const, customerId: existingId };

  const customer = await input.stripe.customers.create({
    email: input.email,
    metadata: buildSafeStripeMetadata({ client_id: input.clientId }),
  }, {
    idempotencyKey: `${input.idempotencyKey}:customer`,
  });
  if (customer.livemode || !customer.id) {
    return { ok: false as const, code: "stripe_customer_create_failed" as const };
  }
  await upsertStripeBillingProfile(supabase, {
    clientId: input.clientId,
    stripeCustomerId: customer.id,
    billingEmail: input.email,
  });
  return { ok: true as const, customerId: customer.id };
}

async function buildSubscriptionLineItems(
  supabase: SupabaseClient,
  input: {
    components: StripeBillingComponent[];
    pricingSnapshotFingerprint: string;
    commercialMode: CommercialMode;
  },
) {
  const lineItems = [];
  for (const component of input.components) {
    if (isPublicCatalogComponent(component)) {
      const row = await loadStripeComponentPriceCatalogRow(supabase, {
        environment: "test",
        component,
      });
      if (!row?.active || row.environment !== "test" || !isValidStripePriceId(row.stripe_price_id)) {
        return { ok: false as const, code: "stripe_component_price_mapping_missing" as const };
      }
      lineItems.push({ price: row.stripe_price_id, quantity: 1 });
      continue;
    }

    const product = await resolveStripeProductIdForComponent(supabase, {
      environment: "test",
      component,
    });
    if (!product) return { ok: false as const, code: "stripe_component_product_mapping_missing" as const };
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: component.currency,
        unit_amount: component.amountCents,
        recurring: {
          interval: "month" as const,
          interval_count: component.billingIntervalMonths,
        },
        product,
        metadata: buildSafeStripeMetadata({
          pricing_snapshot_fingerprint: input.pricingSnapshotFingerprint,
          component_kind: component.componentKind,
          commercial_mode: input.commercialMode,
        }),
      },
    });
  }
  return { ok: true as const, lineItems };
}

export async function createStripeSubscriptionCheckoutSession(
  supabase: SupabaseClient,
  input: CreateStripeSubscriptionCheckoutInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CreateStripeSubscriptionCheckoutResult> {
  try {
    requireStripeTestConfig(env);
  } catch (error) {
    const code = error instanceof StripeFoundationError ? error.code : "stripe_test_not_configured";
    return { ok: false, status: 503, code, messageEn: "Stripe Test checkout is not configured." };
  }

  const readiness = await getStripeTestReadiness(supabase, env);
  if (!isStripeTestFoundationReady(readiness)) {
    return { ok: false, status: 503, code: "stripe_test_not_configured", messageEn: "Stripe Test foundation is incomplete." };
  }

  const email = readString(input.purchaserEmail).toLowerCase();
  if (!email.includes("@")) {
    return { ok: false, status: 400, code: "invalid_email", messageEn: "Valid email is required." };
  }

  const idempotencyKey = readString(input.idempotencyKey);
  if (!idempotencyKey) {
    return { ok: false, status: 400, code: "idempotency_required", messageEn: "Idempotency key is required." };
  }

  const canonical = normalizeCommercialRequest(input);
  if (!canonical.ok) return canonical;
  const { commercialMode, planKey, billingIntervalMonths, outreachAddonKey } = canonical;

  const fallbackOrigin = (() => {
    try {
      return new URL(input.successUrl).origin;
    } catch {
      return "";
    }
  })();
  const allowedOrigins = input.allowedOrigins?.length
    ? input.allowedOrigins
    : [fallbackOrigin].filter(Boolean);
  if (!validateCheckoutUrl(input.successUrl, allowedOrigins) || !validateCheckoutUrl(input.cancelUrl, allowedOrigins)) {
    return { ok: false, status: 400, code: "checkout_url_origin_forbidden", messageEn: "Checkout redirect origin is not allowed." };
  }

  const flowType = input.flowType === "additional_account" ? "additional_account" : "first_purchase";

  if (flowType === "first_purchase") {
    const secretResult = requireCheckoutSignupCredentialSecret(env);
    if (!secretResult.ok) {
      return {
        ok: false,
        status: 503,
        code: secretResult.code,
        messageEn: secretResult.messageEn,
      };
    }
    const passwordValidation = validateStripeFirstPurchaseSignupPassword({
      password: input.password,
      passwordConfirmation: input.passwordConfirmation ?? input.password,
    });
    if (!passwordValidation.ok) {
      return {
        ok: false,
        status: 400,
        code: passwordValidation.code,
        messageEn: passwordValidation.messageEn,
      };
    }
  }

  const simulationAccess = await evaluateCheckoutSimulationAccess({
    supabase,
    email,
    flowType,
    clientId: input.clientId ?? null,
    planKey: planKey ?? "growth",
    billingIntervalMonths,
    env,
    prodTestOnly: flowType === "first_purchase",
  });
  if (!simulationAccess.allowed && flowType === "first_purchase") {
    return {
      ok: false,
      status: 403,
      code: readString(simulationAccess.reason, "authorization_required"),
      messageEn: simulationAccess.messageEn ?? "Checkout authorization is required.",
    };
  }

  const quote = commercialMode === "full_cycle"
    ? buildCommercialQuote({
      planKey: planKey ?? "",
      billingIntervalMonths,
      outreachAddonKey,
      linkedAccountCount: 0,
      reservedEntitlementCount: 0,
      pricingContext: flowType === "additional_account" ? "new_account" : "first_purchase",
    })
    : buildOutreachOnlyCommercialQuote({
      outreachAddonKey: outreachAddonKey as OutreachAddonKey,
      billingIntervalMonths,
    });
  if ("error" in quote) {
    return { ok: false, status: 400, code: quote.error, messageEn: "Invalid checkout selection." };
  }

  const components = quote.planKey !== null
    ? componentsFromPricingSnapshot(quote.pricingSnapshot, "full_cycle")
    : buildOutreachOnlyComponents({
      outreachAddonKey: quote.outreachAddonKey,
      billingIntervalMonths: quote.billingIntervalMonths,
    });
  if (!Array.isArray(components)) {
    return { ok: false, status: 400, code: components.code, messageEn: "Invalid billing components." };
  }
  const lineItems = await buildSubscriptionLineItems(supabase, {
    components,
    pricingSnapshotFingerprint: quote.pricingSnapshot.version,
    commercialMode,
  });
  if (!lineItems.ok) {
    return { ok: false, status: 503, code: lineItems.code, messageEn: "Stripe test component mapping is missing." };
  }

  let clientId = input.clientId ?? null;
  const authUserId = flowType === "additional_account" ? input.authUserId ?? null : null;
  if (flowType === "first_purchase") {
    clientId = null;
  }

  const pendingSession = await createInternalCheckoutSessionPending(supabase, {
    idempotencyKey,
    flowType,
    purchaserEmail: email,
    clientId,
    authUserId,
    planKey,
    billingIntervalMonths,
    outreachAddonKey,
    commercialMode,
    pricingSnapshotFingerprint: quote.pricingSnapshot.version,
    quoteSnapshot: quote as unknown as Record<string, unknown>,
    pricingSnapshot: quote.pricingSnapshot as unknown as Record<string, unknown>,
    catalogSnapshot: quote.catalogSnapshot as unknown as Record<string, unknown>,
    totalPeriodCents: quote.totalPeriodCents,
    metadataSafe: {
      prod_test_authorization_id: simulationAccess.prodTestAuthorizationId,
      checkout_access_source: simulationAccess.source,
    },
  });
  if (!pendingSession.ok) {
    return { ok: false, status: 503, code: pendingSession.code, messageEn: "Could not create internal checkout session." };
  }

  const binding = validateEntitlementBillingBinding({
    clientId: clientId ?? "pending-client",
    entitlementId: pendingSession.checkoutSessionId,
    accountId: null,
    commercialMode,
    pricingSnapshotFingerprint: quote.pricingSnapshot.version,
    pricingMode: components.every(isPublicCatalogComponent) ? "public_catalog" : "immutable_snapshot",
    components,
  });
  if (!binding.ok) {
    return { ok: false, status: 400, code: binding.code, messageEn: "Invalid entitlement billing binding." };
  }

  const metadata = buildSafeStripeMetadata({
    internal_attempt_id: idempotencyKey,
    internal_checkout_session_id: pendingSession.checkoutSessionId,
    flow_type: flowType,
    commercial_mode: commercialMode,
    pricing_snapshot_fingerprint: quote.pricingSnapshot.version,
  });
  rejectUnsafeStripeMetadataKeys(metadata);

  const stripe = input.stripe ?? getStripeClient(env);
  const customer = await resolveStripeCustomer(supabase, {
    stripe,
    clientId,
    email,
    idempotencyKey: pendingSession.checkoutSessionId,
  });
  if (!customer.ok) {
    return { ok: false, status: 503, code: customer.code, messageEn: "Could not resolve Stripe customer." };
  }
  const stripeSessionInput: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    client_reference_id: pendingSession.checkoutSessionId,
    line_items: lineItems.lineItems,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata,
    subscription_data: {
      metadata,
    },
  };
  if (customer.customerId) {
    stripeSessionInput.customer = customer.customerId;
  } else {
    stripeSessionInput.customer_email = email;
  }
  const stripeSession = await stripe.checkout.sessions.create(stripeSessionInput, {
    idempotencyKey: `${pendingSession.checkoutSessionId}:checkout`,
  });

  if (!stripeSession.id || !stripeSession.url) {
    return { ok: false, status: 503, code: "stripe_session_create_failed", messageEn: "Stripe checkout session could not be created." };
  }

  if (flowType === "first_purchase" && input.password) {
    const credentialStored = await storeCheckoutPendingSignupCredential(supabase, {
      checkoutSessionId: pendingSession.checkoutSessionId,
      idempotencyKey,
      password: input.password,
      passwordConfirmation: input.passwordConfirmation ?? input.password,
      purchaserEmail: email,
      flowType,
      commercialMode,
      expiresAtUnix: stripeSession.expires_at ?? null,
    }, env);
    if (!credentialStored.ok) {
      await supabase
        .from("commercial_checkout_sessions")
        .update({ status: "checkout_failed", updated_at: new Date().toISOString() })
        .eq("id", pendingSession.checkoutSessionId);
      return { ok: false, status: 503, code: credentialStored.code, messageEn: credentialStored.messageEn };
    }
  }

  const attempt = await createStripeCheckoutAttempt(supabase, {
    commercialCheckoutSessionId: pendingSession.checkoutSessionId,
    idempotencyKey,
    flowType,
    stripeCheckoutSessionId: stripeSession.id,
    checkoutMode: "subscription",
    purchaserEmail: email,
    clientId,
    authUserId,
    stripeCustomerId: typeof stripeSession.customer === "string" ? stripeSession.customer : customer.customerId,
    clientAccountEntitlementId: "entitlementId" in pendingSession ? readString(pendingSession.entitlementId) || null : null,
    commercialMode,
    pricingSnapshotFingerprint: quote.pricingSnapshot.version,
    metadataSafe: metadata,
  });
  if (!attempt.ok) {
    return { ok: false, status: 503, code: attempt.code, messageEn: "Could not record Stripe checkout attempt." };
  }

  return {
    ok: true,
    checkoutUrl: stripeSession.url,
    internalAttemptId: attempt.attemptId,
    internalCheckoutSessionId: pendingSession.checkoutSessionId,
  };
}
