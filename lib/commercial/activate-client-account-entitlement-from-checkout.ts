import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMMERCIAL_PLANS,
  OUTREACH_ADDONS,
  type CheckoutFlowType,
  type OutreachAddonKey,
  type PlanKey,
} from "./catalog";
import {
  evaluatePublicCheckoutConflict,
  normalizeCheckoutEmail,
  resolveCheckoutContext,
  resolveCheckoutHandoff,
  handoffToRedirectPath,
  type CheckoutContext,
  type CheckoutSessionSnapshot,
} from "./checkout-context";
import { logCheckoutActivation } from "./checkout-activation-log.ts";
import {
  compensateFailedActivationAttempt,
  type ActivationAttemptTracker,
} from "./checkout-compensation.ts";
import { verifyActivationCompletion } from "./checkout-completion.ts";
import { resolveSimulatedPublicAuth, lookupPurchaserAuthState } from "./checkout-auth.ts";
import { findIncompleteCheckoutSessionForClient } from "./checkout-provisioning-state.ts";
import {
  buildClientUserInsertPayload,
  buildSimulatedCheckoutSubscriptionPayload,
  buildTenantUserInsertPayload,
} from "./checkout-workspace-payloads.ts";
import {
  countLinkedInstagramAccountsForClient,
  countReservedEntitlementsForClient,
  insertCheckoutAuditEvent,
} from "./entitlements";
import { buildCommercialQuote } from "./pricing";
import { pricingSnapshotAuditPayload } from "./pricing-snapshot";
import { validatePublicCheckoutPassword } from "./checkout-password";
import { confirmCommercialPayment } from "./confirm-commercial-payment.ts";
import { evaluateCheckoutSimulationAccess } from "./checkout-simulation-access.ts";
import {
  buildInternalTestClientMetadata,
  recordProdTestCheckoutAuthorizationUsage,
} from "./prod-test-checkout-authorization.ts";
import { simulatedCheckoutClientMessages } from "./simulated-checkout-guard.ts";
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
  browserSession?: CheckoutSessionSnapshot | null;
  password?: string | null;
  passwordConfirmation?: string | null;
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
    redirectPath: string | null;
    handoff: ReturnType<typeof resolveCheckoutHandoff>;
    checkoutContext: CheckoutContext;
    activationCompletionVerified: true;
    quote: ReturnType<typeof buildCommercialQuote> extends infer T
      ? T extends { ok: false } ? never : T
      : never;
  }
  | { ok: false; status: number; error: string; code: string; messageFr?: string; messageEn?: string; redirectPath?: string | null; handoff?: ReturnType<typeof resolveCheckoutHandoff> };

class CheckoutActivationStageError extends Error {
  stage: string;
  reason: string;
  postgresCode?: string;

  constructor(stage: string, reason: string, postgresCode?: string) {
    super(reason);
    this.stage = stage;
    this.reason = reason;
    this.postgresCode = postgresCode;
  }
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function postgresCodeFromError(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
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

async function failWithCompensation(
  supabase: SupabaseClient,
  tracker: ActivationAttemptTracker,
  input: {
    status: number;
    code: string;
    stage: string;
    reason: string;
    postgresCode?: string;
    messageFr?: string;
    messageEn?: string;
  },
): Promise<Extract<ActivateCheckoutResult, { ok: false }>> {
  await compensateFailedActivationAttempt(supabase, tracker, {
    stage: input.stage,
    reason: input.reason,
    postgresCode: input.postgresCode,
  });
  logCheckoutActivation({
    event: "checkout_activation_failed",
    idempotencyKey: tracker.idempotencyKey,
    authUserId: tracker.authUserId,
    clientId: tracker.clientId,
    stage: input.stage,
    reason: input.reason,
    postgresCode: input.postgresCode,
  });
  return activationFailure(input.status, input.code, {
    messageFr: input.messageFr,
    messageEn: input.messageEn,
  });
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

async function ensureSessionAuthUserId(supabase: SupabaseClient, authUserId: string) {
  const { data, error } = await supabase.auth.admin.getUserById(authUserId);
  if (error || !data.user?.id) {
    console.error("[commercial/checkout/activate] session auth user lookup failed", { authUserId, error });
    return { ok: false as const };
  }
  return { ok: true as const, authUserId: data.user.id };
}

async function ensureClientWorkspace(
  supabase: SupabaseClient,
  input: {
    checkoutContext: CheckoutContext;
    clientId?: string | null;
    resumeClientId?: string | null;
    email: string;
    authUserId: string;
    displayName: string;
    idempotencyKey: string;
    tracker?: ActivationAttemptTracker;
    internalTestClient?: boolean;
  },
) {
  let clientId = input.resumeClientId?.trim()
    || (input.checkoutContext === "public_new_workspace" ? "" : input.clientId?.trim() || "");
  let clientCreatedThisAttempt = false;

  if (!clientId) {
    const { data: createdClient, error: clientError } = await supabase
      .from("clients")
      .insert({
        name: input.displayName,
        status: "active",
        metadata: input.internalTestClient
          ? buildInternalTestClientMetadata({ email: input.email, displayName: input.displayName })
          : {
            contact_email: input.email,
            display_name: input.displayName,
            service_page_url: "/instagram-growth",
            preferred_language: "fr",
            checkout_source: "simulated_checkout",
          },
      })
      .select("id")
      .single<Row>();
    if (clientError || !createdClient?.id) {
      throw new CheckoutActivationStageError("client_create", "client_create_failed", postgresCodeFromError(clientError));
    }
    clientId = readString(createdClient.id);
    clientCreatedThisAttempt = true;
    if (input.tracker) {
      input.tracker.clientId = clientId;
      input.tracker.clientCreatedThisAttempt = true;
    }
    logCheckoutActivation({
      event: "checkout_workspace_created",
      idempotencyKey: input.idempotencyKey,
      authUserId: input.authUserId,
      clientId,
      stage: "client_create",
    });
  } else {
    if (input.tracker) {
      input.tracker.clientId = clientId;
    }
    const { data: existingClient, error: existingClientError } = await supabase
      .from("clients")
      .select("id,status")
      .eq("id", clientId)
      .limit(1)
      .maybeSingle<Row>();
    if (existingClientError || !existingClient?.id || readString(existingClient.status) !== "active") {
      throw new CheckoutActivationStageError("client_validate", "client_unavailable", postgresCodeFromError(existingClientError));
    }
  }

  const { data: tenantUser } = await supabase
    .from("tenant_users")
    .select("user_id,tenant_id,role")
    .eq("user_id", input.authUserId)
    .limit(1)
    .maybeSingle<Row>();

  const hadTenantBeforeLink = Boolean(tenantUser?.user_id);

  if (!tenantUser?.user_id) {
    const tenantPayload = buildTenantUserInsertPayload({
      authUserId: input.authUserId,
      clientId,
    });
    const { error: tenantInsertError } = await supabase.from("tenant_users").insert(tenantPayload);
    if (tenantInsertError) {
      throw new CheckoutActivationStageError(
        "tenant_user_create",
        "tenant_user_create_failed",
        postgresCodeFromError(tenantInsertError),
      );
    }
    logCheckoutActivation({
      event: "checkout_tenant_user_created",
      idempotencyKey: input.idempotencyKey,
      authUserId: input.authUserId,
      clientId,
      stage: "tenant_user_create",
    });
  } else if (readString(tenantUser.tenant_id) !== clientId) {
    if (input.checkoutContext === "public_new_workspace") {
      throw new CheckoutActivationStageError("tenant_user_create", "tenant_user_already_linked");
    }
    const { error: tenantUpdateError } = await supabase
      .from("tenant_users")
      .update({ tenant_id: clientId })
      .eq("user_id", input.authUserId);
    if (tenantUpdateError) {
      throw new CheckoutActivationStageError(
        "tenant_user_update",
        "tenant_user_update_failed",
        postgresCodeFromError(tenantUpdateError),
      );
    }
  }

  const { data: clientUser } = await supabase
    .from("client_users")
    .select("id,status")
    .eq("client_id", clientId)
    .eq("auth_user_id", input.authUserId)
    .limit(1)
    .maybeSingle<Row>();

  if (!clientUser?.id) {
    const { error: clientUserError } = await supabase
      .from("client_users")
      .insert(buildClientUserInsertPayload({ clientId, authUserId: input.authUserId }));
    if (clientUserError) {
      throw new CheckoutActivationStageError(
        "client_user_create",
        "client_user_create_failed",
        postgresCodeFromError(clientUserError),
      );
    }
  } else if (readString(clientUser.status) !== "active") {
    const { error: clientUserUpdateError } = await supabase
      .from("client_users")
      .update({ status: "active" })
      .eq("id", clientUser.id);
    if (clientUserUpdateError) {
      throw new CheckoutActivationStageError(
        "client_user_update",
        "client_user_update_failed",
        postgresCodeFromError(clientUserUpdateError),
      );
    }
  }

  const { data: existingSubscription } = await supabase
    .from("client_subscriptions")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle<Row>();

  if (!existingSubscription?.id) {
    const { error: subscriptionError } = await supabase
      .from("client_subscriptions")
      .insert(buildSimulatedCheckoutSubscriptionPayload(clientId, {
        internalTestClient: input.internalTestClient,
      }));
    if (subscriptionError) {
      throw new CheckoutActivationStageError(
        "client_subscription_create",
        "client_subscription_create_failed",
        postgresCodeFromError(subscriptionError),
      );
    }
  }

  const tenantLinkedThisAttempt = hadTenantBeforeLink
    ? readString(tenantUser?.tenant_id) === clientId
    : true;

  return { clientId, clientCreatedThisAttempt, tenantLinkedThisAttempt };
}

async function finalizeSuccessfulActivation(
  supabase: SupabaseClient,
  input: {
    idempotencyKey: string;
    authUserId: string;
    clientId: string;
    checkoutSessionId: string;
    entitlementId: string;
  },
) {
  const completion = await verifyActivationCompletion(supabase, input);
  if (!completion.ok) {
    throw new CheckoutActivationStageError("activation_completion_verify", completion.reason);
  }
  logCheckoutActivation({
    event: "checkout_activation_completion_verified",
    idempotencyKey: input.idempotencyKey,
    authUserId: input.authUserId,
    clientId: input.clientId,
    stage: "activation_completion_verify",
  });
  return completion.activationCompletionVerified;
}

export async function activateClientAccountEntitlementFromCheckout(
  supabase: SupabaseClient,
  input: ActivateCheckoutInput,
): Promise<ActivateCheckoutResult> {
  const tracker: ActivationAttemptTracker = {
    idempotencyKey: input.idempotencyKey.trim(),
    authCreatedThisAttempt: false,
    authUserId: null,
    clientCreatedThisAttempt: false,
    clientId: null,
    tenantLinkedThisAttempt: false,
    resumedIncompleteCheckout: false,
  };

  try {
    if (input.mode !== "simulated") {
      return activationFailure(501, "stripe_not_enabled", {
        messageFr: "Le paiement réel n'est pas encore disponible.",
        messageEn: "Real payment is not available yet.",
      });
    }

    const email = normalizeCheckoutEmail(input.purchaserEmail);
    const checkoutContext = resolveCheckoutContext({ flowType: input.flowType });
    const handoff = resolveCheckoutHandoff(checkoutContext);
    const redirectPath = handoffToRedirectPath(handoff);

    logCheckoutActivation({
      event: "checkout_public_activation_started",
      idempotencyKey: tracker.idempotencyKey,
      stage: checkoutContext,
    });

    if (!tracker.idempotencyKey) {
      return activationFailure(400, "idempotency_required", {
        messageFr: "Impossible de confirmer cette activation de test.",
        messageEn: "Could not confirm this test activation.",
      });
    }

    const existing = await findExistingActivatedSession(supabase, tracker.idempotencyKey);
    if (existing.kind === "storage_error") {
      return activationFailure(503, "checkout_storage_unavailable");
    }

    if (existing.kind !== "found" && input.flowType !== "plan_change") {
      const simulationAccess = await evaluateCheckoutSimulationAccess({
        supabase,
        email,
        flowType: input.flowType,
        clientId: input.clientId?.trim() || null,
        planKey: input.planKey,
        billingIntervalMonths: input.billingIntervalMonths,
      });
      if (!simulationAccess.allowed) {
        const messages = simulationAccess.messageFr && simulationAccess.messageEn
          ? { messageFr: simulationAccess.messageFr, messageEn: simulationAccess.messageEn }
          : simulatedCheckoutClientMessages("invalid_email");
        return {
          ok: false,
          status: 403,
          error: messages.messageFr,
          messageFr: messages.messageFr,
          messageEn: messages.messageEn,
          code: readString(simulationAccess.reason, "simulation_unavailable"),
        };
      }
      tracker.prodTestAuthorizationId = simulationAccess.prodTestAuthorizationId;
      tracker.simulationAccessSource = simulationAccess.source;
    }

    if (checkoutContext === "public_new_workspace" && existing.kind === "missing") {
      const passwordValidation = validatePublicCheckoutPassword({
        password: input.password ?? "",
        passwordConfirmation: input.passwordConfirmation ?? "",
      });
      if (!passwordValidation.ok) {
        return activationFailure(400, passwordValidation.code, {
          messageFr: passwordValidation.messageFr,
          messageEn: passwordValidation.messageEn,
        });
      }
    }

    const quoteResult = buildCommercialQuote({
      planKey: input.planKey,
      billingIntervalMonths: input.billingIntervalMonths,
      outreachAddonKey: input.outreachAddonKey,
      linkedAccountCount: 0,
      reservedEntitlementCount: 0,
      pricingContext: "first_purchase",
    });
    if ("error" in quoteResult) {
      return activationFailure(400, quoteResult.error, {
        messageFr: "Sélection checkout invalide.",
        messageEn: "Invalid checkout selection.",
      });
    }

    if (existing.kind !== "found" && checkoutContext === "public_new_workspace") {
      const payment = confirmCommercialPayment({
        provider: "simulated",
        purchaserEmail: email,
        amountDueCents: quoteResult.totalPeriodCents,
        idempotencyKey: tracker.idempotencyKey,
        checkoutContext,
        simulationAccessSource: tracker.simulationAccessSource === "prod_test_authorization"
          ? "prod_test_authorization"
          : null,
      });
      if (!payment.ok) {
        return {
          ok: false,
          status: 403,
          error: payment.messageFr,
          messageFr: payment.messageFr,
          messageEn: payment.messageEn,
          code: payment.code,
        };
      }
    }

    if (existing.kind === "found") {
      const verified = await finalizeSuccessfulActivation(supabase, {
        idempotencyKey: tracker.idempotencyKey,
        authUserId: existing.authUserId ?? "",
        clientId: existing.clientId,
        checkoutSessionId: existing.checkoutSessionId,
        entitlementId: existing.entitlementId,
      });
      return {
        ok: true,
        idempotentReplay: true,
        checkoutSessionId: existing.checkoutSessionId,
        entitlementId: existing.entitlementId,
        clientId: existing.clientId,
        authUserId: existing.authUserId,
        redirectPath,
        handoff,
        checkoutContext,
        activationCompletionVerified: verified,
        quote: quoteResult,
      };
    }

    let scopedClientId = checkoutContext === "public_new_workspace" ? "" : input.clientId?.trim() || "";
    let scopedAuthUserId = checkoutContext === "public_new_workspace" ? null : input.authUserId?.trim() || null;
    let resumeClientId: string | null = null;
    let resumeExistingCheckoutSessionId: string | null = null;
    let resumeExistingEntitlementId: string | null = null;

    if (checkoutContext === "public_new_workspace" && existing.kind !== "partial") {
      const purchaserAuthState = await lookupPurchaserAuthState(supabase, email);
      if (!purchaserAuthState.ok) {
        return activationFailure(503, "checkout_storage_unavailable");
      }

      const conflict = evaluatePublicCheckoutConflict({
        checkoutContext,
        session: input.browserSession ?? null,
        purchaserEmail: email,
        purchaserAuthUserHasTenant: purchaserAuthState.hasTenant,
        purchaserHasIncompleteResumableCheckout: purchaserAuthState.hasIncompleteResumableCheckout,
      });
      if (!conflict.ok) {
        const conflictHandoff = conflict.redirectPath === "/instagram-client/choose-plan"
          ? { type: "choose_plan" as const, redirectPath: conflict.redirectPath }
          : conflict.redirectPath === "/instagram-login"
            ? { type: "email_login" as const, loginPath: conflict.redirectPath }
            : undefined;
        return {
          ok: false,
          status: 409,
          error: conflict.messageFr,
          messageFr: conflict.messageFr,
          messageEn: conflict.messageEn,
          code: conflict.code,
          redirectPath: conflict.redirectPath,
          handoff: conflictHandoff,
        };
      }
    }

    let finalQuote = quoteResult;
    let clientId = scopedClientId;
    let authUserId = scopedAuthUserId;
    let checkoutSessionId = existing.kind === "partial" ? existing.checkoutSessionId : "";
    let existingEntitlementId = "";

    if (existing.kind === "partial") {
      clientId = existing.clientId;
      authUserId = existing.authUserId;
    } else {
      const linkedCount = clientId ? await countLinkedInstagramAccountsForClient(supabase, clientId) : 0;
      const reservedCount = clientId ? await countReservedEntitlementsForClient(supabase, clientId) : 0;
      const pricedQuote = buildCommercialQuote({
        planKey: input.planKey,
        billingIntervalMonths: input.billingIntervalMonths,
        outreachAddonKey: input.outreachAddonKey,
        linkedAccountCount: linkedCount,
        reservedEntitlementCount: reservedCount,
        pricingContext: checkoutContext === "public_new_workspace" ? "first_purchase" : "new_account",
        reservedRepresentsQuotedPurchase: reservedCount > 0,
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
        if (checkoutContext === "public_new_workspace") {
          const authResult = await resolveSimulatedPublicAuth(supabase, {
            email,
            password: input.password ?? "",
            idempotencyKey: tracker.idempotencyKey,
          });
          if (!authResult.ok) {
            return activationFailure(
              authResult.code === "auth_user_exists_no_workspace" || authResult.code === "password_verification_failed"
                ? (authResult.code === "password_verification_failed" ? 401 : 409)
                : 503,
              authResult.code,
              { messageFr: authResult.messageFr, messageEn: authResult.messageEn },
            );
          }
          authUserId = authResult.authUserId;
          tracker.authUserId = authUserId;
          tracker.authCreatedThisAttempt = authResult.createdAuth;
          tracker.resumedIncompleteCheckout = authResult.resumedOrphan;
          resumeClientId = authResult.resumeClientId;
          resumeExistingCheckoutSessionId = authResult.existingCheckoutSessionId;
          resumeExistingEntitlementId = authResult.existingEntitlementId;

          if (authResult.resumeMode === "replay_complete" && authResult.existingCheckoutSessionId && authResult.existingEntitlementId) {
            const verified = await finalizeSuccessfulActivation(supabase, {
              idempotencyKey: tracker.idempotencyKey,
              authUserId: authResult.authUserId,
              clientId: authResult.resumeClientId ?? "",
              checkoutSessionId: authResult.existingCheckoutSessionId,
              entitlementId: authResult.existingEntitlementId,
            }).catch((error) => {
              if (error instanceof CheckoutActivationStageError) return null;
              throw error;
            });
            if (verified) {
              return {
                ok: true,
                idempotentReplay: true,
                checkoutSessionId: authResult.existingCheckoutSessionId,
                entitlementId: authResult.existingEntitlementId,
                clientId: authResult.resumeClientId ?? "",
                authUserId: authResult.authUserId,
                redirectPath,
                handoff,
                checkoutContext,
                activationCompletionVerified: verified,
                quote: finalQuote,
              };
            }
          }
        } else if (input.authUserId) {
          const sessionAuth = await ensureSessionAuthUserId(supabase, input.authUserId);
          if (!sessionAuth.ok) {
            return activationFailure(503, "auth_user_unavailable");
          }
          authUserId = sessionAuth.authUserId;
          tracker.authUserId = authUserId;
        } else {
          return activationFailure(401, "session_required", {
            messageFr: "Connexion client requise pour cet achat.",
            messageEn: "Client login is required for this purchase.",
          });
        }
      }

      const plan = COMMERCIAL_PLANS[finalQuote.planKey as PlanKey];
      const workspace = await ensureClientWorkspace(supabase, {
        checkoutContext,
        clientId: clientId || null,
        resumeClientId,
        email,
        authUserId,
        displayName: plan.displayName,
        idempotencyKey: tracker.idempotencyKey,
        tracker,
        internalTestClient: tracker.simulationAccessSource === "prod_test_authorization",
      });
      clientId = workspace.clientId;
      tracker.clientId = clientId;
      tracker.clientCreatedThisAttempt = workspace.clientCreatedThisAttempt;
      tracker.tenantLinkedThisAttempt = workspace.tenantLinkedThisAttempt;

      if (!checkoutSessionId && resumeExistingCheckoutSessionId) {
        checkoutSessionId = resumeExistingCheckoutSessionId;
      } else if (!checkoutSessionId && resumeClientId) {
        const incompleteSession = await findIncompleteCheckoutSessionForClient(supabase, resumeClientId);
        if (incompleteSession.kind === "partial") {
          checkoutSessionId = incompleteSession.checkoutSessionId;
          authUserId = authUserId ?? incompleteSession.authUserId;
        } else if (incompleteSession.kind === "storage_error") {
          return activationFailure(503, "checkout_storage_unavailable");
        }
      }

      if (!existingEntitlementId && resumeExistingEntitlementId) {
        existingEntitlementId = resumeExistingEntitlementId;
      }
    }

    if (!authUserId) {
      return activationFailure(500, "activation_failed");
    }
    tracker.authUserId = authUserId;
    tracker.clientId = clientId;

    const plan = COMMERCIAL_PLANS[finalQuote.planKey as PlanKey];
    const outreachAddon = finalQuote.outreachAddonKey
      ? OUTREACH_ADDONS[finalQuote.outreachAddonKey as OutreachAddonKey]
      : null;

    const now = new Date().toISOString();

    const skipCheckoutSessionInsert = existing.kind === "partial" || Boolean(checkoutSessionId);

    if (!skipCheckoutSessionInsert) {
      const { data: checkoutSession, error: checkoutError } = await supabase
        .from("commercial_checkout_sessions")
        .insert({
          idempotency_key: tracker.idempotencyKey,
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
          pricing_snapshot: finalQuote.pricingSnapshot,
          metadata: {
            mode: "simulated",
            payment_provider: "simulated",
            payment_status: "simulated_confirmed",
            checkout_context: checkoutContext,
            internal_test_client: tracker.simulationAccessSource === "prod_test_authorization",
            billing_excluded: tracker.simulationAccessSource === "prod_test_authorization",
          },
          activated_at: now,
          updated_at: now,
        })
        .select("id")
        .single<Row>();

      if (checkoutError || !checkoutSession?.id) {
        return failWithCompensation(supabase, tracker, {
          status: 500,
          code: "checkout_create_failed",
          stage: "checkout_session_create",
          reason: "checkout_create_failed",
          postgresCode: postgresCodeFromError(checkoutError),
        });
      }
      checkoutSessionId = readString(checkoutSession.id);
    }

    let entitlementId = existingEntitlementId;

    if (!entitlementId) {
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
        pricing_snapshot: finalQuote.pricingSnapshot,
        status: "entitlement_reserved",
        metadata: {
          growth_estimate_label: plan.growthEstimateLabelFr,
          checkout_mode: "simulated",
          checkout_context: checkoutContext,
          internal_test_client: tracker.simulationAccessSource === "prod_test_authorization",
          billing_excluded: tracker.simulationAccessSource === "prod_test_authorization",
        },
        updated_at: now,
      })
      .select("id")
      .single<Row>();

      if (entitlementError || !entitlement?.id) {
        return failWithCompensation(supabase, tracker, {
          status: 500,
          code: "entitlement_create_failed",
          stage: "entitlement_create",
          reason: "entitlement_create_failed",
          postgresCode: postgresCodeFromError(entitlementError),
        });
      }

      entitlementId = readString(entitlement.id);
    }
    const auditPayload = {
      ...pricingSnapshotAuditPayload(finalQuote.pricingSnapshot),
      plan_key: finalQuote.planKey,
      billing_interval_months: finalQuote.billingIntervalMonths,
      outreach_addon_key: finalQuote.outreachAddonKey,
      idempotency_key: tracker.idempotencyKey,
      flow_type: input.flowType,
      checkout_context: checkoutContext,
    };
    if ("password" in auditPayload) {
      throw new Error("audit_payload_password_leak_guard");
    }

    const { data: existingAudit, error: existingAuditError } = await supabase
      .from("commercial_checkout_audit_events")
      .select("id")
      .eq("checkout_session_id", checkoutSessionId)
      .limit(1)
      .maybeSingle<Row>();
    if (existingAuditError) {
      return failWithCompensation(supabase, tracker, {
        status: 503,
        code: "checkout_storage_unavailable",
        stage: "audit_event_lookup",
        reason: "audit_event_lookup_failed",
        postgresCode: postgresCodeFromError(existingAuditError),
      });
    }

    if (!existingAudit?.id) {
      const auditResult = await insertCheckoutAuditEvent(supabase, {
        checkoutSessionId,
        entitlementId,
        eventType: "simulated_checkout_activated",
        actorEmail: email,
        clientId,
        payload: auditPayload,
      });
      if (!auditResult.ok) {
        return failWithCompensation(supabase, tracker, {
          status: 500,
          code: "audit_create_failed",
          stage: "audit_event_create",
          reason: "audit_create_failed",
          postgresCode: auditResult.postgresCode,
        });
      }
    }

    let activationCompletionVerified: true;
    try {
      activationCompletionVerified = await finalizeSuccessfulActivation(supabase, {
        idempotencyKey: tracker.idempotencyKey,
        authUserId,
        clientId,
        checkoutSessionId,
        entitlementId,
      });
    } catch (error) {
      if (error instanceof CheckoutActivationStageError) {
        return failWithCompensation(supabase, tracker, {
          status: 500,
          code: "activation_failed",
          stage: error.stage,
          reason: error.reason,
          postgresCode: error.postgresCode,
        });
      }
      throw error;
    }

    if (tracker.prodTestAuthorizationId && input.flowType !== "plan_change") {
      try {
        await recordProdTestCheckoutAuthorizationUsage({
          supabase,
          authorizationId: tracker.prodTestAuthorizationId,
          flowType: input.flowType,
          clientId,
        });
      } catch (usageError) {
        console.error("[commercial/checkout/activate] prod test authorization usage update failed", usageError);
        return failWithCompensation(supabase, tracker, {
          status: 500,
          code: "prod_test_authorization_update_failed",
          stage: "prod_test_authorization_usage",
          reason: "prod_test_authorization_update_failed",
        });
      }
    }

    return {
      ok: true,
      idempotentReplay: existing.kind === "partial" || tracker.resumedIncompleteCheckout,
      checkoutSessionId,
      entitlementId,
      clientId,
      authUserId,
      redirectPath,
      handoff,
      checkoutContext,
      activationCompletionVerified,
      quote: finalQuote,
    };
  } catch (error) {
    if (error instanceof CheckoutActivationStageError) {
      return failWithCompensation(supabase, tracker, {
        status: error.reason === "tenant_user_already_linked" ? 409 : 500,
        code: error.reason === "tenant_user_already_linked"
          ? "existing_workspace_use_choose_plan"
          : "activation_failed",
        stage: error.stage,
        reason: error.reason,
        postgresCode: error.postgresCode,
        messageFr: error.reason === "tenant_user_already_linked"
          ? "Un espace client existe déjà pour cette adresse e-mail. Connectez-vous pour ajouter un compte depuis votre espace client."
          : undefined,
        messageEn: error.reason === "tenant_user_already_linked"
          ? "A client workspace already exists for this email address. Sign in to add an account from your workspace."
          : undefined,
      });
    }
    logCheckoutActivation({
      event: "checkout_activation_failed",
      idempotencyKey: tracker.idempotencyKey,
      authUserId: tracker.authUserId,
      clientId: tracker.clientId,
      stage: "unexpected",
      reason: "activation_failed",
    });
    await compensateFailedActivationAttempt(supabase, tracker, {
      stage: "unexpected",
      reason: "activation_failed",
    });
    return activationFailure(500, "activation_failed");
  }
}
