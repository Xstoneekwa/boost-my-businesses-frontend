import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveAgencyModeSnapshot } from "./agency";
import {
  COMMERCIAL_PLANS,
  OUTREACH_ADDONS,
  type CheckoutFlowType,
  type OutreachAddonKey,
  type PlanKey,
} from "./catalog";
import {
  countLinkedInstagramAccountsForClient,
  countReservedEntitlementsForClient,
  insertCheckoutAuditEvent,
} from "./entitlements";
import { buildCommercialQuote } from "./pricing";
import { canUseSimulatedCheckoutForEmail, simulatedCheckoutClientMessages } from "./simulated-checkout-guard";

type Row = Record<string, unknown>;

export type ActivateCheckoutInput = {
  planKey: string;
  billingIntervalMonths: number;
  outreachAddonKey?: string | null;
  purchaserEmail: string;
  idempotencyKey: string;
  flowType: CheckoutFlowType;
  clientId?: string | null;
  authUserId?: string | null;
  mode: "simulated" | "stripe";
};

export type ActivateCheckoutResult =
  | {
    ok: true;
    idempotentReplay: boolean;
    checkoutSessionId: string;
    entitlementId: string;
    clientId: string;
    authUserId: string | null;
    redirectPath: string;
    quote: ReturnType<typeof buildCommercialQuote> extends infer T
      ? T extends { ok: false } ? never : T
      : never;
  }
  | { ok: false; status: number; error: string; code: string; messageFr?: string; messageEn?: string };

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

async function findExistingActivatedSession(supabase: SupabaseClient, idempotencyKey: string) {
  const { data, error } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,client_id,auth_user_id,status")
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw new Error("checkout_lookup_failed");
  if (!data?.id || readString(data.status) !== "checkout_activated_test") return null;
  const { data: entitlement } = await supabase
    .from("client_account_entitlements")
    .select("id")
    .eq("checkout_session_id", readString(data.id))
    .limit(1)
    .maybeSingle<Row>();
  return {
    checkoutSessionId: readString(data.id),
    clientId: readString(data.client_id),
    authUserId: readString(data.auth_user_id) || null,
    entitlementId: readString(entitlement?.id),
  };
}

async function findAuthUserIdByEmail(supabase: SupabaseClient, email: string) {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error("auth_user_lookup_failed");
  const match = (data.users ?? []).find((user) => (user.email ?? "").trim().toLowerCase() === normalized);
  return match?.id ?? null;
}

async function ensureAuthUserId(supabase: SupabaseClient, email: string) {
  const existing = await findAuthUserIdByEmail(supabase, email);
  if (existing) return existing;
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/instagram-login`,
  });
  if (error || !data.user?.id) throw new Error("auth_user_create_failed");
  return data.user.id;
}

async function ensureClientWorkspace(
  supabase: SupabaseClient,
  input: { clientId?: string | null; email: string; authUserId: string; displayName: string },
) {
  let clientId = input.clientId?.trim() || "";
  if (!clientId) {
    const { data: createdClient, error: clientError } = await supabase
      .from("clients")
      .insert({
        name: input.displayName,
        status: "active",
        metadata: {
          contact_email: input.email,
          display_name: input.displayName,
          service_page_url: "/instagram-growth",
          preferred_language: "fr",
          checkout_source: "simulated_checkout",
        },
      })
      .select("id")
      .single<Row>();
    if (clientError || !createdClient?.id) throw new Error("client_create_failed");
    clientId = readString(createdClient.id);
  } else {
    const { data: existingClient, error: existingClientError } = await supabase
      .from("clients")
      .select("id,status")
      .eq("id", clientId)
      .limit(1)
      .maybeSingle<Row>();
    if (existingClientError || !existingClient?.id || readString(existingClient.status) !== "active") {
      throw new Error("client_unavailable");
    }
  }

  const { data: tenantUser } = await supabase
    .from("tenant_users")
    .select("user_id,tenant_id")
    .eq("user_id", input.authUserId)
    .limit(1)
    .maybeSingle<Row>();

  if (!tenantUser?.user_id) {
    const { error: tenantInsertError } = await supabase.from("tenant_users").insert({
      user_id: input.authUserId,
      tenant_id: clientId,
      role: "client",
    });
    if (tenantInsertError) throw new Error("tenant_user_create_failed");
  } else if (readString(tenantUser.tenant_id) !== clientId) {
    const { error: tenantUpdateError } = await supabase
      .from("tenant_users")
      .update({ tenant_id: clientId })
      .eq("user_id", input.authUserId);
    if (tenantUpdateError) throw new Error("tenant_user_update_failed");
  }

  const { data: clientUser } = await supabase
    .from("client_users")
    .select("id,status")
    .eq("client_id", clientId)
    .eq("auth_user_id", input.authUserId)
    .limit(1)
    .maybeSingle<Row>();

  if (!clientUser?.id) {
    const { error: clientUserError } = await supabase.from("client_users").insert({
      client_id: clientId,
      auth_user_id: input.authUserId,
      role: "owner",
      status: "active",
    });
    if (clientUserError) throw new Error("client_user_create_failed");
  } else if (readString(clientUser.status) !== "active") {
    const { error: clientUserUpdateError } = await supabase
      .from("client_users")
      .update({ status: "active" })
      .eq("id", clientUser.id);
    if (clientUserUpdateError) throw new Error("client_user_update_failed");
  }

  const { data: existingSubscription } = await supabase
    .from("client_subscriptions")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle<Row>();

  if (!existingSubscription?.id) {
    const { error: subscriptionError } = await supabase.from("client_subscriptions").insert({
      client_id: clientId,
      subscription_type: "full_cycle",
      status: "active",
      metadata: {
        source: "simulated_checkout",
        billing_mode: "per_account_entitlement",
      },
    });
    if (subscriptionError) throw new Error("client_subscription_create_failed");
  }

  return clientId;
}

export async function activateClientAccountEntitlementFromCheckout(
  supabase: SupabaseClient,
  input: ActivateCheckoutInput,
): Promise<ActivateCheckoutResult> {
  if (input.mode !== "simulated") {
    return { ok: false, status: 501, error: "Only simulated checkout is available in this phase.", code: "stripe_not_enabled" };
  }

  const email = input.purchaserEmail.trim().toLowerCase();
  const guard = canUseSimulatedCheckoutForEmail(email);
  if (!guard.ok) {
    const messages = simulatedCheckoutClientMessages(guard.reason);
    return {
      ok: false,
      status: 403,
      error: messages.messageFr,
      messageFr: messages.messageFr,
      messageEn: messages.messageEn,
      code: guard.reason,
    };
  }

  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) {
    return { ok: false, status: 400, error: "Missing idempotency key.", code: "idempotency_required" };
  }

  const existing = await findExistingActivatedSession(supabase, idempotencyKey);
  if (existing?.checkoutSessionId && existing.clientId && existing.entitlementId) {
    const replayQuote = buildCommercialQuote({
      planKey: input.planKey,
      billingIntervalMonths: input.billingIntervalMonths,
      outreachAddonKey: input.outreachAddonKey,
      billableAccountCount: 1,
    });
    if ("error" in replayQuote) {
      return { ok: false, status: 500, error: "Could not rebuild quote.", code: "quote_failed" };
    }
    return {
      ok: true,
      idempotentReplay: true,
      checkoutSessionId: existing.checkoutSessionId,
      entitlementId: existing.entitlementId,
      clientId: existing.clientId,
      authUserId: existing.authUserId,
      redirectPath: "/instagram-client",
      quote: replayQuote,
    };
  }

  let clientId = input.clientId?.trim() || "";
  const linkedCount = clientId ? await countLinkedInstagramAccountsForClient(supabase, clientId) : 0;
  const reservedCount = clientId ? await countReservedEntitlementsForClient(supabase, clientId) : 0;
  const agencySnapshot = deriveAgencyModeSnapshot({
    linkedAccountCount: linkedCount,
    reservedEntitlementCount: reservedCount,
  });
  const billableAccountCount = agencySnapshot.billableAccountCount + 1;

  const quoteResult = buildCommercialQuote({
    planKey: input.planKey,
    billingIntervalMonths: input.billingIntervalMonths,
    outreachAddonKey: input.outreachAddonKey,
    billableAccountCount,
  });
  if ("error" in quoteResult) {
    return { ok: false, status: 400, error: "Invalid checkout selection.", code: quoteResult.error };
  }

  if (clientId && reservedCount > 0) {
    return {
      ok: false,
      status: 409,
      error: "A reserved entitlement already exists for this workspace.",
      code: "reserved_entitlement_exists",
    };
  }

  const authUserId = input.authUserId?.trim() || await ensureAuthUserId(supabase, email);
  const plan = COMMERCIAL_PLANS[quoteResult.planKey as PlanKey];
  const outreachAddon = quoteResult.outreachAddonKey
    ? OUTREACH_ADDONS[quoteResult.outreachAddonKey as OutreachAddonKey]
    : null;

  clientId = await ensureClientWorkspace(supabase, {
    clientId: clientId || null,
    email,
    authUserId,
    displayName: plan.displayName,
  });

  const now = new Date().toISOString();
  const { data: checkoutSession, error: checkoutError } = await supabase
    .from("commercial_checkout_sessions")
    .insert({
      idempotency_key: idempotencyKey,
      flow_type: input.flowType,
      status: "checkout_activated_test",
      client_id: clientId,
      auth_user_id: authUserId,
      purchaser_email: email,
      plan_key: quoteResult.planKey,
      billing_interval_months: quoteResult.billingIntervalMonths,
      outreach_addon_key: quoteResult.outreachAddonKey,
      billable_account_count: quoteResult.billableAccountCount,
      term_discount_percent: quoteResult.termDiscountPercent,
      agency_discount_percent: quoteResult.agencyDiscountPercent,
      applied_discount_percent: quoteResult.appliedDiscountPercent,
      applied_discount_type: quoteResult.appliedDiscountType,
      pack_base_monthly_cents: quoteResult.packLine.baseMonthlyPriceCents,
      pack_monthly_discounted_cents: quoteResult.packLine.monthlyDiscountedPriceCents,
      pack_period_total_cents: quoteResult.packLine.billingPeriodTotalCents,
      outreach_base_monthly_cents: quoteResult.outreachLine?.baseMonthlyPriceCents ?? null,
      outreach_monthly_discounted_cents: quoteResult.outreachLine?.monthlyDiscountedPriceCents ?? null,
      outreach_period_total_cents: quoteResult.outreachLine?.billingPeriodTotalCents ?? null,
      total_period_cents: quoteResult.totalPeriodCents,
      catalog_snapshot: quoteResult.catalogSnapshot,
      metadata: {
        mode: "simulated",
        agency_mode_displayed: deriveAgencyModeSnapshot({
          linkedAccountCount: linkedCount,
          reservedEntitlementCount: reservedCount + 1,
        }).agencyModeDisplayed,
      },
      activated_at: now,
      updated_at: now,
    })
    .select("id")
    .single<Row>();

  if (checkoutError || !checkoutSession?.id) {
    return { ok: false, status: 500, error: "Could not create checkout session.", code: "checkout_create_failed" };
  }

  const checkoutSessionId = readString(checkoutSession.id);
  const { data: entitlement, error: entitlementError } = await supabase
    .from("client_account_entitlements")
    .insert({
      client_id: clientId,
      checkout_session_id: checkoutSessionId,
      plan_key: quoteResult.planKey,
      commercial_package_code: plan.commercialPackageCode,
      billing_interval_months: quoteResult.billingIntervalMonths,
      outreach_addon_key: quoteResult.outreachAddonKey,
      outreach_variant: outreachAddon?.outreachVariant ?? null,
      backend_addon_code: outreachAddon?.backendAddonCode ?? null,
      applied_discount_percent: quoteResult.appliedDiscountPercent,
      applied_discount_type: quoteResult.appliedDiscountType,
      pack_monthly_discounted_cents: quoteResult.packLine.monthlyDiscountedPriceCents,
      pack_period_total_cents: quoteResult.packLine.billingPeriodTotalCents,
      outreach_monthly_discounted_cents: quoteResult.outreachLine?.monthlyDiscountedPriceCents ?? null,
      outreach_period_total_cents: quoteResult.outreachLine?.billingPeriodTotalCents ?? null,
      total_period_cents: quoteResult.totalPeriodCents,
      catalog_snapshot: quoteResult.catalogSnapshot,
      status: "entitlement_reserved",
      metadata: {
        growth_estimate_label: plan.growthEstimateLabelFr,
        checkout_mode: "simulated",
      },
      updated_at: now,
    })
    .select("id")
    .single<Row>();

  if (entitlementError || !entitlement?.id) {
    return { ok: false, status: 500, error: "Could not create entitlement.", code: "entitlement_create_failed" };
  }

  const entitlementId = readString(entitlement.id);
  await insertCheckoutAuditEvent(supabase, {
    checkoutSessionId,
    entitlementId,
    eventType: "simulated_checkout_activated",
    actorEmail: email,
    clientId,
    payload: {
      plan_key: quoteResult.planKey,
      billing_interval_months: quoteResult.billingIntervalMonths,
      outreach_addon_key: quoteResult.outreachAddonKey,
      total_period_cents: quoteResult.totalPeriodCents,
      idempotency_key: idempotencyKey,
      flow_type: input.flowType,
    },
  });

  return {
    ok: true,
    idempotentReplay: false,
    checkoutSessionId,
    entitlementId,
    clientId,
    authUserId,
    redirectPath: "/instagram-client",
    quote: quoteResult,
  };
}
