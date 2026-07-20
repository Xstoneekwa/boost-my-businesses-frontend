import type { SupabaseClient } from "@supabase/supabase-js";
import { logCheckoutActivation } from "./checkout-activation-log.ts";
import { inspectSimulatedCheckoutProvisioning } from "./checkout-provisioning-state.ts";
import {
  resolveIncompleteCheckoutResume,
  verifyPurchaserPasswordControl,
} from "./checkout-orphan-resume.ts";

type Row = Record<string, unknown>;

export type SimulatedPublicAuthResult =
  | {
    ok: true;
    authUserId: string;
    createdAuth: boolean;
    createdClient: boolean;
    resumedOrphan: boolean;
    resumeClientId: string | null;
    resumeMode: "none" | "link_orphan_client" | "complete_partial" | "replay_complete";
    existingCheckoutSessionId: string | null;
    existingEntitlementId: string | null;
  }
  | {
    ok: false;
    code:
      | "auth_user_exists_no_workspace"
      | "auth_user_create_failed"
      | "checkout_storage_unavailable"
      | "existing_auth_requires_verified_access"
      | "password_verification_failed"
      | "existing_workspace_use_choose_plan";
    messageFr: string;
    messageEn: string;
  };

async function findAuthUserIdByEmail(supabase: SupabaseClient, email: string) {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.error("[commercial/checkout/auth] auth user lookup failed", { email: normalized, error });
    return { ok: false as const };
  }
  const match = (data.users ?? []).find((user) => (user.email ?? "").trim().toLowerCase() === normalized);
  return { ok: true as const, authUserId: match?.id ?? null };
}

async function authUserHasTenant(supabase: SupabaseClient, authUserId: string) {
  const { data, error } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", authUserId)
    .limit(1)
    .maybeSingle<Row>();
  if (error) {
    console.error("[commercial/checkout/auth] tenant lookup failed", { authUserId, error });
    return { ok: false as const };
  }
  return { ok: true as const, hasTenant: Boolean(data?.tenant_id) };
}

export async function lookupPurchaserAuthState(supabase: SupabaseClient, email: string) {
  const lookup = await findAuthUserIdByEmail(supabase, email);
  if (!lookup.ok) return { ok: false as const };
  if (!lookup.authUserId) {
    return {
      ok: true as const,
      hasAuthUser: false,
      hasTenant: false,
      authUserId: null,
      hasIncompleteResumableCheckout: false,
    };
  }
  const tenantLookup = await authUserHasTenant(supabase, lookup.authUserId);
  if (!tenantLookup.ok) return { ok: false as const };

  let hasIncompleteResumableCheckout = false;
  if (lookup.authUserId) {
    const inspection = await inspectSimulatedCheckoutProvisioning(supabase, {
      email,
      authUserId: lookup.authUserId,
    });
    hasIncompleteResumableCheckout = inspection.ok
      && (inspection.isResumableIncomplete || inspection.resumeMode === "replay_complete");
  }

  return {
    ok: true as const,
    hasAuthUser: true,
    hasTenant: tenantLookup.hasTenant,
    authUserId: lookup.authUserId,
    hasIncompleteResumableCheckout,
  };
}

const AUTH_EXISTS_NO_WORKSPACE_MESSAGES = {
  messageFr:
    "Un compte existe déjà pour cette adresse e-mail sans espace client actif. Connectez-vous ou contactez le support.",
  messageEn:
    "An account already exists for this email without an active client workspace. Sign in or contact support.",
};

const AUTH_EXISTS_WITH_WORKSPACE_MESSAGES = {
  messageFr:
    "Un espace client existe déjà pour cette adresse e-mail. Connectez-vous pour accéder à votre espace.",
  messageEn:
    "A client workspace already exists for this email address. Sign in to access your workspace.",
};

const AUTH_EXISTS_REQUIRES_VERIFIED_ACCESS_MESSAGES = {
  messageFr:
    "Un compte existe déjà pour cette adresse e-mail. Connectez-vous avec son mot de passe actuel avant de continuer.",
  messageEn:
    "An account already exists for this email. Sign in with its current password before continuing.",
};

export async function authorizeStripeFirstPurchaseAuth(
  supabase: SupabaseClient,
  input: { email: string; password?: string | null },
) {
  const email = input.email.trim().toLowerCase();
  const lookup = await findAuthUserIdByEmail(supabase, email);
  if (!lookup.ok) {
    return {
      ok: false as const,
      code: "checkout_storage_unavailable" as const,
      status: 503,
      messageEn: "Checkout identity verification is temporarily unavailable.",
    };
  }
  if (!lookup.authUserId) {
    return { ok: true as const, mode: "new_user" as const, authUserId: null };
  }

  const tenantLookup = await authUserHasTenant(supabase, lookup.authUserId);
  if (!tenantLookup.ok) {
    return {
      ok: false as const,
      code: "checkout_storage_unavailable" as const,
      status: 503,
      messageEn: "Checkout identity verification is temporarily unavailable.",
    };
  }
  if (tenantLookup.hasTenant) {
    return {
      ok: false as const,
      code: "existing_workspace_use_choose_plan" as const,
      status: 409,
      messageEn: AUTH_EXISTS_WITH_WORKSPACE_MESSAGES.messageEn,
    };
  }
  if (!input.password) {
    return {
      ok: false as const,
      code: "existing_auth_requires_verified_access" as const,
      status: 409,
      messageEn: AUTH_EXISTS_REQUIRES_VERIFIED_ACCESS_MESSAGES.messageEn,
    };
  }

  const passwordProof = await verifyPurchaserPasswordControl({
    email,
    password: input.password,
    expectedAuthUserId: lookup.authUserId,
  });
  if (!passwordProof.ok) {
    return {
      ok: false as const,
      code: passwordProof.reason === "storage_error"
        ? "checkout_storage_unavailable" as const
        : "existing_auth_requires_verified_access" as const,
      status: passwordProof.reason === "storage_error" ? 503 : 409,
      messageEn: passwordProof.reason === "storage_error"
        ? "Checkout identity verification is temporarily unavailable."
        : AUTH_EXISTS_REQUIRES_VERIFIED_ACCESS_MESSAGES.messageEn,
    };
  }

  return {
    ok: true as const,
    mode: "existing_user_verified" as const,
    authUserId: lookup.authUserId,
  };
}

export async function resolveSimulatedPublicAuth(
  supabase: SupabaseClient,
  input: {
    email: string;
    password: string;
    idempotencyKey: string;
  },
): Promise<SimulatedPublicAuthResult> {
  const email = input.email.trim().toLowerCase();
  const lookup = await findAuthUserIdByEmail(supabase, email);
  if (!lookup.ok) {
    return {
      ok: false,
      code: "checkout_storage_unavailable",
      messageFr: "L'activation de test est temporairement indisponible. Réessayez dans quelques instants.",
      messageEn: "Test activation is temporarily unavailable. Please try again shortly.",
    };
  }

  if (lookup.authUserId) {
    const resume = await resolveIncompleteCheckoutResume(supabase, {
      email,
      authUserId: lookup.authUserId,
      password: input.password,
      idempotencyKey: input.idempotencyKey,
    });
    if (!resume.ok) {
      if (resume.code === "password_verification_failed") {
        return {
          ok: false,
          code: "password_verification_failed",
          messageFr: "Mot de passe incorrect pour cette adresse e-mail.",
          messageEn: "Incorrect password for this email address.",
        };
      }
      if (resume.code === "existing_workspace_use_choose_plan") {
        return {
          ok: false,
          code: "existing_workspace_use_choose_plan",
          ...AUTH_EXISTS_WITH_WORKSPACE_MESSAGES,
        };
      }
      if (resume.code === "checkout_storage_unavailable") {
        return {
          ok: false,
          code: "checkout_storage_unavailable",
          messageFr: "L'activation de test est temporairement indisponible. Réessayez dans quelques instants.",
          messageEn: "Test activation is temporarily unavailable. Please try again shortly.",
        };
      }
      return {
        ok: false,
        code: "auth_user_exists_no_workspace",
        ...AUTH_EXISTS_NO_WORKSPACE_MESSAGES,
      };
    }

    return {
      ok: true,
      authUserId: resume.authUserId,
      createdAuth: false,
      createdClient: false,
      resumedOrphan: resume.resumedOrphan,
      resumeClientId: resume.resumeClientId,
      resumeMode: resume.resumeMode,
      existingCheckoutSessionId: resume.existingCheckoutSessionId,
      existingEntitlementId: resume.existingEntitlementId,
    };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user?.id) {
    logCheckoutActivation({
      event: "checkout_activation_failed",
      idempotencyKey: input.idempotencyKey,
      stage: "auth_create",
      reason: "auth_user_create_failed",
      postgresCode: error?.code,
    });
    return {
      ok: false,
      code: "auth_user_create_failed",
      messageFr: "Impossible de créer votre accès client pour le moment.",
      messageEn: "Could not create your client access right now.",
    };
  }

  return {
    ok: true,
    authUserId: data.user.id,
    createdAuth: true,
    createdClient: false,
    resumedOrphan: false,
    resumeClientId: null,
    resumeMode: "none",
    existingCheckoutSessionId: null,
    existingEntitlementId: null,
  };
}

export async function resolveStripePaidPublicAuth(
  supabase: SupabaseClient,
  input: {
    email: string;
    idempotencyKey: string;
    password?: string | null;
  },
): Promise<SimulatedPublicAuthResult> {
  const email = input.email.trim().toLowerCase();
  const authorization = await authorizeStripeFirstPurchaseAuth(supabase, {
    email,
    password: input.password,
  });
  if (!authorization.ok) {
    return {
      ok: false,
      code: authorization.code,
      messageFr: authorization.code === "existing_workspace_use_choose_plan"
        ? AUTH_EXISTS_WITH_WORKSPACE_MESSAGES.messageFr
        : authorization.code === "existing_auth_requires_verified_access"
          ? AUTH_EXISTS_REQUIRES_VERIFIED_ACCESS_MESSAGES.messageFr
          : "L'activation de test est temporairement indisponible. Réessayez dans quelques instants.",
      messageEn: authorization.messageEn,
    };
  }

  if (authorization.mode === "existing_user_verified") {
    return {
      ok: true,
      authUserId: authorization.authUserId,
      createdAuth: false,
      createdClient: false,
      resumedOrphan: false,
      resumeClientId: null,
      resumeMode: "none",
      existingCheckoutSessionId: null,
      existingEntitlementId: null,
    };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    ...(input.password ? { password: input.password } : {}),
    email_confirm: true,
  });
  if (error || !data.user?.id) {
    logCheckoutActivation({
      event: "checkout_activation_failed",
      idempotencyKey: input.idempotencyKey,
      stage: "auth_create",
      reason: "auth_user_create_failed",
      postgresCode: error?.code,
    });
    return {
      ok: false,
      code: "auth_user_create_failed",
      messageFr: "Impossible de créer votre accès client pour le moment.",
      messageEn: "Could not create your client access right now.",
    };
  }

  return {
    ok: true,
    authUserId: data.user.id,
    createdAuth: true,
    createdClient: false,
    resumedOrphan: false,
    resumeClientId: null,
    resumeMode: "none",
    existingCheckoutSessionId: null,
    existingEntitlementId: null,
  };
}

export async function ensureSimulatedPublicAuthUser(
  supabase: SupabaseClient,
  input: { email: string; password: string; idempotencyKey?: string },
): Promise<SimulatedPublicAuthResult> {
  return resolveSimulatedPublicAuth(supabase, {
    email: input.email,
    password: input.password,
    idempotencyKey: input.idempotencyKey ?? "legacy",
  });
}
