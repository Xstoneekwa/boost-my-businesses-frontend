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
import { CHECKOUT_UNAVAILABLE_EN, CHECKOUT_UNAVAILABLE_FR } from "./checkout-api-messages.ts";

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

function activationFailure(
  status: number,
  code: string,
  input?: { messageFr?: string; messageEn?: string },
): Extract<ActivateCheckoutResult, { ok: false }> {
  const messages = input?.messageFr
    ? { messageFr: input.messageFr, messageEn: input.messageEn ?? CHECKOUT_UNAVAILABLE_EN }
    : (code === "checkout_storage_unavailable" || code === "activation_failed"
      ? { messageFr: CHECKOUT_UNAVAILABLE_FR, messageEn: CHECKOUT_UNAVAILABLE_EN }
      : simulatedCheckoutClientMessages("invalid_email"));
  return {
    ok: false,
    status,
    error: messages.messageFr,
    messageFr: messages.messageFr,
    messageEn: messages.messageEn,
    code,
  };
}

async function findExistingActivatedSession(supabase: SupabaseClient, idempotencyKey: string) {
  const { data, error } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,client_id,auth_user_id,status")
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle<Row>();
  if (error) {
    console.error("[commercial/checkout/activate] checkout session lookup failed", { idempotencyKey, error });
    return { kind: "storage_error" as const };
  }
  if (!data?.id || readString(data.status) !== "checkout_activated_test") {
    return { kind: "missing" as const };
  }
  const { data: entitlement, error: entitlementError } = await supabase
    .from("client_account_entitlements")
    .select("id")
    .eq("checkout_session_id", readString(data.id))
    .limit(1)
    .maybeSingle<Row>();
  if (entitlementError) {
    console.error("[commercial/checkout/activate] entitlement lookup failed", {
      idempotencyKey,
      checkoutSessionId: readString(data.id),
      error: entitlementError,
    });
    return { kind: "storage_error" as const };
  }
  if (!entitlement?.id) {
    return {
      kind: "partial" as const,
      checkoutSessionId: readString(data.id),
      clientId: readString(data.client_id),
      authUserId: readString(data.auth_user_id) || null,
    };
  }
  return {
    kind: "found" as const,
    checkoutSessionId: readString(data.id),
    clientId: readString(data.client_id),
    authUserId: readString(data.auth_user_id) || null,
    entitlementId: readString(entitlement.id),
  };
}

async function findAuthUserIdByEmail(supabase: SupabaseClient, email: string) {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.error("[commercial/checkout/activate] auth user lookup failed", { email: normalized, error });
    return null;
  }
  const match = (data.users ?? []).find((user) => (user.email ?? "").trim().toLowerCase() === normalized);
  return match?.id ?? null;
}

async function ensureAuthUserId(supabase: SupabaseClient, email: string) {
  const existing = await findAuthUserIdByEmail(supabase, email);
  if (existing) return { ok: true as const, authUserId: existing };
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/instagram-login`,
  });
  if (error || !data.user?.id) {
    console.error("[commercial/checkout/activate] auth user create failed", { email, error });
    return { ok: false as const };
  }
  return { ok: true as const, authUserId: data.user.id };
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
  try {
    if (input.mode !== "simulated") {
      return activationFailure(501, "stripe_not_enabled", {
        messageFr: "Le paiement réel n'est pas encore disponible.",
        messageEn: "Real payment is not available yet.",
      });
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
      return activationFailure(400, "idempotency_required", {
        messageFr: "Impossible de confirmer cette activation de test.",
        messageEn: "Could not confirm this test activation.",
      });
    }

    const existing = await findExistingActivatedSession(supabase, idempotencyKey);
    if (existing.kind === "storage_error") {
      return activationFailure(503, "checkout_storage_unavailable");
    }

    const quoteResult = buildCommercialQuote({
      planKey: input.planKey,
      billingIntervalMonths: input.billingIntervalMonths,
      outreachAddonKey: input.outreachAddonKey,
      billableAccountCount: 1,
    });
    if ("error" in quoteResult) {
      return activationFailure(400, quoteResult.error, {
        messageFr: "Sélection checkout invalide.",
        messageEn: "Invalid checkout selection.",
      });
    }

    if (existing.kind === "found") {
      return {
        ok: true,
        idempotentReplay: true,
        checkoutSessionId: existing.checkoutSessionId,
        entitlementId: existing.entitlementId,
        clientId: existing.clientId,
        authUserId: existing.authUserId,
        redirectPath: "/instagram-client",
        quote: quoteResult,
      };
    }

    let finalQuote = quoteResult;
    let clientId = input.clientId?.trim() || "";
    let authUserId = input.authUserId?.trim() || null;
    let checkoutSessionId = existing.kind === "partial" ? existing.checkoutSessionId : "";

    if (existing.kind === "partial") {
      clientId = existing.clientId;
      authUserId = existing.authUserId;
    } else {
      const linkedCount = clientId ? await countLinkedInstagramAccountsForClient(supabase, clientId) : 0;
      const reservedCount = clientId ? await countReservedEntitlementsForClient(supabase, clientId) : 0;
      const agencySnapshot = deriveAgencyModeSnapshot({
        linkedAccountCount: linkedCount,
        reservedEntitlementCount: reservedCount,
      });
      const pricedQuote = buildCommercialQuote({
        planKey: input.planKey,
        billingIntervalMonths: input.billingIntervalMonths,
        outreachAddonKey: input.outreachAddonKey,
        billableAccountCount: agencySnapshot.billableAccountCount + 1,
      });
      if ("error" in pricedQuote) {
        return activationFailure(400, pricedQuote.error, {
          messageFr: "Sélection checkout invalide.",
          messageEn: "Invalid checkout selection.",
        });
      }
      finalQuote = pricedQuote;
      if (clientId && reservedCount > 0) {
        return activationFailure(409, "reserved_entitlement_exists", {
          messageFr: "Une activation de compte est déjà en attente pour cet espace.",
          messageEn: "An account activation is already pending for this workspace.",
        });
      }

      if (!authUserId) {
        const authResult = await ensureAuthUserId(supabase, email);
        if (!authResult.ok) {
          return activationFailure(503, "auth_user_unavailable");
        }
        authUserId = authResult.authUserId;
      }

      const plan = COMMERCIAL_PLANS[finalQuote.planKey as PlanKey];
      clientId = await ensureClientWorkspace(supabase, {
        clientId: clientId || null,
        email,
        authUserId,
        displayName: plan.displayName,
      });
    }

    const plan = COMMERCIAL_PLANS[finalQuote.planKey as PlanKey];
    const outreachAddon = finalQuote.outreachAddonKey
      ? OUTREACH_ADDONS[finalQuote.outreachAddonKey as OutreachAddonKey]
      : null;

    if (!authUserId) {
      const authResult = await ensureAuthUserId(supabase, email);
      if (!authResult.ok) {
        return activationFailure(503, "auth_user_unavailable");
      }
      authUserId = authResult.authUserId;
    }

    const now = new Date().toISOString();

    if (existing.kind !== "partial") {
      const { data: checkoutSession, error: checkoutError } = await supabase
        .from("commercial_checkout_sessions")
        .insert({
          idempotency_key: idempotencyKey,
          flow_type: input.flowType,
          status: "checkout_activated_test",
          client_id: clientId,
          auth_user_id: authUserId,
          purchaser_email: email,
          plan_key: finalQuote.planKey,
          billing_interval_months: finalQuote.billingIntervalMonths,
          outreach_addon_key: finalQuote.outreachAddonKey,
          billable_account_count: finalQuote.billableAccountCount,
          term_discount_percent: finalQuote.termDiscountPercent,
          agency_discount_percent: finalQuote.agencyDiscountPercent,
          applied_discount_percent: finalQuote.appliedDiscountPercent,
          applied_discount_type: finalQuote.appliedDiscountType,
          pack_base_monthly_cents: finalQuote.packLine.baseMonthlyPriceCents,
          pack_monthly_discounted_cents: finalQuote.packLine.monthlyDiscountedPriceCents,
          pack_period_total_cents: finalQuote.packLine.billingPeriodTotalCents,
          outreach_base_monthly_cents: finalQuote.outreachLine?.baseMonthlyPriceCents ?? null,
          outreach_monthly_discounted_cents: finalQuote.outreachLine?.monthlyDiscountedPriceCents ?? null,
          outreach_period_total_cents: finalQuote.outreachLine?.billingPeriodTotalCents ?? null,
          total_period_cents: finalQuote.totalPeriodCents,
          catalog_snapshot: finalQuote.catalogSnapshot,
          metadata: { mode: "simulated" },
          activated_at: now,
          updated_at: now,
        })
        .select("id")
        .single<Row>();

      if (checkoutError || !checkoutSession?.id) {
        console.error("[commercial/checkout/activate] checkout session create failed", {
          idempotencyKey,
          checkoutError,
        });
        return activationFailure(500, "checkout_create_failed");
      }
      checkoutSessionId = readString(checkoutSession.id);
    }

    const { data: entitlement, error: entitlementError } = await supabase
      .from("client_account_entitlements")
      .insert({
        client_id: clientId,
        checkout_session_id: checkoutSessionId,
        plan_key: finalQuote.planKey,
        commercial_package_code: plan.commercialPackageCode,
        billing_interval_months: finalQuote.billingIntervalMonths,
        outreach_addon_key: finalQuote.outreachAddonKey,
        outreach_variant: outreachAddon?.outreachVariant ?? null,
        backend_addon_code: outreachAddon?.backendAddonCode ?? null,
        applied_discount_percent: finalQuote.appliedDiscountPercent,
        applied_discount_type: finalQuote.appliedDiscountType,
        pack_monthly_discounted_cents: finalQuote.packLine.monthlyDiscountedPriceCents,
        pack_period_total_cents: finalQuote.packLine.billingPeriodTotalCents,
        outreach_monthly_discounted_cents: finalQuote.outreachLine?.monthlyDiscountedPriceCents ?? null,
        outreach_period_total_cents: finalQuote.outreachLine?.billingPeriodTotalCents ?? null,
        total_period_cents: finalQuote.totalPeriodCents,
        catalog_snapshot: finalQuote.catalogSnapshot,
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
      console.error("[commercial/checkout/activate] entitlement create failed", {
        idempotencyKey,
        checkoutSessionId,
        entitlementError,
      });
      return activationFailure(500, "entitlement_create_failed");
    }

    const entitlementId = readString(entitlement.id);
    await insertCheckoutAuditEvent(supabase, {
      checkoutSessionId,
      entitlementId,
      eventType: "simulated_checkout_activated",
      actorEmail: email,
      clientId,
      payload: {
        plan_key: finalQuote.planKey,
        billing_interval_months: finalQuote.billingIntervalMonths,
        outreach_addon_key: finalQuote.outreachAddonKey,
        total_period_cents: finalQuote.totalPeriodCents,
        idempotency_key: idempotencyKey,
        flow_type: input.flowType,
      },
    });

    return {
      ok: true,
      idempotentReplay: existing.kind === "partial",
      checkoutSessionId,
      entitlementId,
      clientId,
      authUserId,
      redirectPath: "/instagram-client",
      quote: finalQuote,
    };
  } catch (error) {
    console.error("[commercial/checkout/activate] unexpected failure", {
      idempotencyKey: input.idempotencyKey,
      error,
    });
    return activationFailure(500, "activation_failed");
  }
}
