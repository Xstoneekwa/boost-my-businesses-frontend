import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export type SimulatedPublicAuthResult =
  | { ok: true; authUserId: string; created: boolean }
  | {
    ok: false;
    code: "auth_user_exists_no_workspace" | "auth_user_create_failed" | "checkout_storage_unavailable";
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

export async function lookupPurchaserAuthState(supabase: SupabaseClient, email: string) {
  const lookup = await findAuthUserIdByEmail(supabase, email);
  if (!lookup.ok) return { ok: false as const };
  if (!lookup.authUserId) {
    return { ok: true as const, hasAuthUser: false, hasTenant: false, authUserId: null };
  }
  const tenantLookup = await authUserHasTenant(supabase, lookup.authUserId);
  if (!tenantLookup.ok) return { ok: false as const };
  return {
    ok: true as const,
    hasAuthUser: true,
    hasTenant: tenantLookup.hasTenant,
    authUserId: lookup.authUserId,
  };
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

export async function ensureSimulatedPublicAuthUser(
  supabase: SupabaseClient,
  input: { email: string; password: string },
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
    const tenantLookup = await authUserHasTenant(supabase, lookup.authUserId);
    if (!tenantLookup.ok) {
      return {
        ok: false,
        code: "checkout_storage_unavailable",
        messageFr: "L'activation de test est temporairement indisponible. Réessayez dans quelques instants.",
        messageEn: "Test activation is temporarily unavailable. Please try again shortly.",
      };
    }
    if (tenantLookup.hasTenant) {
      return {
        ok: false,
        code: "auth_user_exists_no_workspace",
        messageFr:
          "Un espace client existe déjà pour cette adresse e-mail. Connectez-vous pour accéder à votre espace.",
        messageEn: "A client workspace already exists for this email address. Sign in to access your workspace.",
      };
    }
    return {
      ok: false,
      code: "auth_user_exists_no_workspace",
      messageFr:
        "Un compte existe déjà pour cette adresse e-mail sans espace client actif. Connectez-vous ou contactez le support.",
      messageEn:
        "An account already exists for this email without an active client workspace. Sign in or contact support.",
    };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
  });
  if (error || !data.user?.id) {
    console.error("[commercial/checkout/auth] simulated auth user create failed", {
      email,
      errorMessage: error?.message ?? "unknown",
    });
    return {
      ok: false,
      code: "auth_user_create_failed",
      messageFr: "Impossible de créer votre accès client pour le moment.",
      messageEn: "Could not create your client access right now.",
    };
  }

  return { ok: true, authUserId: data.user.id, created: true };
}
