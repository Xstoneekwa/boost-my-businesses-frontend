import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export type ActivationCompletionSnapshot = {
  authUserId: string;
  clientId: string;
  checkoutSessionId: string;
  entitlementId: string;
};

type VerifyActivationCompletionResult =
  | { ok: true; activationCompletionVerified: true }
  | { ok: false; reason: string };

let verifyActivationCompletionOverride:
  | ((supabase: SupabaseClient, snapshot: ActivationCompletionSnapshot) => Promise<VerifyActivationCompletionResult>)
  | null = null;

export function setVerifyActivationCompletionOverrideForTests(
  override: typeof verifyActivationCompletionOverride,
) {
  verifyActivationCompletionOverride = override;
}

export async function verifyActivationCompletion(
  supabase: SupabaseClient,
  snapshot: ActivationCompletionSnapshot,
) {
  if (verifyActivationCompletionOverride) {
    return verifyActivationCompletionOverride(supabase, snapshot);
  }

  const { authUserId, clientId, checkoutSessionId, entitlementId } = snapshot;

  const [
    authUser,
    client,
    tenantUser,
    clientUser,
    subscription,
    entitlement,
    checkoutSession,
    auditEvent,
  ] = await Promise.all([
    supabase.auth.admin.getUserById(authUserId),
    supabase.from("clients").select("id,status").eq("id", clientId).maybeSingle<Row>(),
    supabase.from("tenant_users").select("user_id,tenant_id,role").eq("user_id", authUserId).eq("tenant_id", clientId).maybeSingle<Row>(),
    supabase.from("client_users").select("id").eq("client_id", clientId).eq("auth_user_id", authUserId).maybeSingle<Row>(),
    supabase.from("client_subscriptions").select("id").eq("client_id", clientId).eq("status", "active").maybeSingle<Row>(),
    supabase.from("client_account_entitlements").select("id,status").eq("id", entitlementId).maybeSingle<Row>(),
    supabase.from("commercial_checkout_sessions").select("id,status").eq("id", checkoutSessionId).maybeSingle<Row>(),
    supabase.from("commercial_checkout_audit_events").select("id").eq("checkout_session_id", checkoutSessionId).limit(1).maybeSingle<Row>(),
  ]);

  if (authUser.error || !authUser.data.user?.id) return { ok: false as const, reason: "auth_missing" };
  if (!client.data?.id || readString(client.data.status) !== "active") return { ok: false as const, reason: "client_missing" };
  if (!tenantUser.data?.user_id) return { ok: false as const, reason: "tenant_user_missing" };
  if (readString(tenantUser.data.role) !== "tenant") return { ok: false as const, reason: "tenant_user_role_invalid" };
  if (!clientUser.data?.id) return { ok: false as const, reason: "client_user_missing" };
  if (!subscription.data?.id) return { ok: false as const, reason: "subscription_missing" };
  if (!entitlement.data?.id || readString(entitlement.data.status) !== "entitlement_reserved") {
    return { ok: false as const, reason: "entitlement_missing" };
  }
  if (!checkoutSession.data?.id || readString(checkoutSession.data.status) !== "checkout_activated_test") {
    return { ok: false as const, reason: "checkout_session_missing" };
  }
  if (!auditEvent.data?.id) return { ok: false as const, reason: "audit_event_missing" };

  return { ok: true as const, activationCompletionVerified: true as const };
}
