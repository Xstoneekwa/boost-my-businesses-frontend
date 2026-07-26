import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCheckoutEmail } from "./checkout-context.ts";
import { readServerSupabaseProjectRef } from "./server-supabase-ref.ts";
import type { BillingIntervalMonths, PlanKey } from "./catalog.ts";
import type { CommercialCheckoutProvenance } from "./commercial-provenance.ts";

export const PRODUCTION_CHECKOUT_ALLOWED_REF = "zgafnshkjywfltxgbtzg";

export type ProdTestCheckoutFlow = "first_purchase" | "new_account";

export type ProdTestCheckoutAuthorizationRow = {
  id: string;
  email_hash: string;
  email_hint: string;
  authorized_flows: string[];
  max_accounts: number;
  plan_key: PlanKey | null;
  billing_interval_months: BillingIntervalMonths | null;
  expires_at: string;
  status: "active" | "expired" | "consumed" | "revoked";
  client_id: string | null;
  entitlements_created_count: number;
  first_checkout_used_at: string | null;
  add_account_used_at: string | null;
  created_by_auth_user_id: string;
  admin_confirmation_acknowledged: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ProdTestCheckoutDenyReason =
  | "not_production_environment"
  | "authorization_not_found"
  | "authorization_expired"
  | "authorization_consumed"
  | "authorization_revoked"
  | "flow_not_authorized"
  | "plan_not_authorized"
  | "billing_interval_not_authorized"
  | "workspace_mismatch"
  | "account_limit_reached"
  | "client_already_linked";

export type ProdTestCheckoutAuthorizationAction = "created" | "reused" | "renewed";

export function hashProdTestCheckoutEmail(email: string) {
  const normalized = normalizeCheckoutEmail(email);
  return createHash("sha256").update(normalized).digest("hex");
}

export function redactEmailHint(email: string) {
  const normalized = normalizeCheckoutEmail(email);
  const at = normalized.indexOf("@");
  if (at <= 0) return "***";
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

export function isProductionCheckoutEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return readServerSupabaseProjectRef(env) === PRODUCTION_CHECKOUT_ALLOWED_REF;
}

export function prodTestCheckoutClientMessages(reason: ProdTestCheckoutDenyReason) {
  switch (reason) {
    case "account_limit_reached":
      return {
        messageFr: "Le nombre maximum de comptes autorisés pour cette activation de test est atteint.",
        messageEn: "The maximum number of accounts allowed for this test activation has been reached.",
      };
    case "workspace_mismatch":
      return {
        messageFr: "Cette activation de test ne correspond pas à l'espace client autorisé.",
        messageEn: "This test activation does not match the authorized client workspace.",
      };
    case "plan_not_authorized":
    case "billing_interval_not_authorized":
      return {
        messageFr: "Cette sélection de pack ou de durée n'est pas autorisée pour cette activation de test.",
        messageEn: "This plan or billing term selection is not authorized for this test activation.",
      };
    default:
      return {
        messageFr: "L'activation de test est temporairement indisponible.",
        messageEn: "Test activation is temporarily unavailable.",
      };
  }
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export function isProdTestCheckoutAuthorizationExpired(row: ProdTestCheckoutAuthorizationRow, now = new Date()) {
  return new Date(row.expires_at).getTime() <= now.getTime();
}

function normalizeFlow(flowType: "first_purchase" | "additional_account"): ProdTestCheckoutFlow {
  return flowType === "additional_account" ? "new_account" : "first_purchase";
}

export async function findLatestProdTestCheckoutAuthorization(
  supabase: SupabaseClient,
  email: string,
): Promise<ProdTestCheckoutAuthorizationRow | null> {
  const emailHash = hashProdTestCheckoutEmail(email);
  const { data, error } = await supabase
    .from("commercial_prod_test_checkout_authorizations")
    .select("*")
    .eq("email_hash", emailHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ProdTestCheckoutAuthorizationRow>();

  if (error || !data?.id) return null;
  return data;
}

export function validateProdTestCheckoutAuthorization(input: {
  authorization: ProdTestCheckoutAuthorizationRow;
  flowType: "first_purchase" | "additional_account";
  clientId?: string | null;
  planKey?: string | null;
  billingIntervalMonths?: number | null;
}):
  | { ok: true }
  | { ok: false; reason: ProdTestCheckoutDenyReason } {
  const flow = normalizeFlow(input.flowType);
  const authorization = input.authorization;

  if (authorization.status !== "active") {
    if (authorization.status === "consumed") return { ok: false, reason: "authorization_consumed" };
    if (authorization.status === "revoked") return { ok: false, reason: "authorization_revoked" };
    return { ok: false, reason: "authorization_expired" };
  }
  if (isProdTestCheckoutAuthorizationExpired(authorization)) {
    return { ok: false, reason: "authorization_expired" };
  }
  if (!authorization.authorized_flows.includes(flow)) {
    return { ok: false, reason: "flow_not_authorized" };
  }
  if (authorization.plan_key && readString(input.planKey) !== authorization.plan_key) {
    return { ok: false, reason: "plan_not_authorized" };
  }
  if (
    authorization.billing_interval_months != null
    && Number(input.billingIntervalMonths) !== authorization.billing_interval_months
  ) {
    return { ok: false, reason: "billing_interval_not_authorized" };
  }

  if (flow === "first_purchase") {
    if (authorization.client_id) {
      return { ok: false, reason: "client_already_linked" };
    }
    if (authorization.entitlements_created_count >= authorization.max_accounts) {
      return { ok: false, reason: "account_limit_reached" };
    }
    return { ok: true };
  }

  const clientId = readString(input.clientId);
  if (!clientId || !authorization.client_id || authorization.client_id !== clientId) {
    return { ok: false, reason: "workspace_mismatch" };
  }
  if (authorization.entitlements_created_count >= authorization.max_accounts) {
    return { ok: false, reason: "account_limit_reached" };
  }
  return { ok: true };
}

export async function evaluateProdTestCheckoutAuthorization(input: {
  supabase: SupabaseClient;
  email: string | null | undefined;
  flowType: "first_purchase" | "additional_account";
  clientId?: string | null;
  planKey?: string | null;
  billingIntervalMonths?: number | null;
  env?: NodeJS.ProcessEnv;
}): Promise<
  | { ok: true; authorization: ProdTestCheckoutAuthorizationRow }
  | { ok: false; reason: ProdTestCheckoutDenyReason | null }
> {
  if (!isProductionCheckoutEnvironment(input.env)) {
    return { ok: false, reason: "not_production_environment" };
  }

  const normalizedEmail = readString(input.email);
  if (!normalizedEmail) {
    return { ok: false, reason: null };
  }

  const authorization = await findLatestProdTestCheckoutAuthorization(input.supabase, normalizedEmail);
  if (!authorization) {
    return { ok: false, reason: "authorization_not_found" };
  }

  const validation = validateProdTestCheckoutAuthorization({
    authorization,
    flowType: input.flowType,
    clientId: input.clientId,
    planKey: input.planKey,
    billingIntervalMonths: input.billingIntervalMonths,
  });
  if (!validation.ok) {
    return validation;
  }

  return { ok: true, authorization };
}

export async function recordProdTestCheckoutAuthorizationUsage(input: {
  supabase: SupabaseClient;
  authorizationId: string;
  flowType: "first_purchase" | "additional_account";
  clientId: string;
  now?: Date;
}) {
  const nowIso = (input.now ?? new Date()).toISOString();
  const flow = normalizeFlow(input.flowType);

  const { data: current, error: readError } = await input.supabase
    .from("commercial_prod_test_checkout_authorizations")
    .select("*")
    .eq("id", input.authorizationId)
    .limit(1)
    .maybeSingle<ProdTestCheckoutAuthorizationRow>();

  if (readError || !current?.id) {
    throw new Error("prod_test_authorization_read_failed");
  }

  const nextCount = current.entitlements_created_count + 1;
  const nextStatus = nextCount >= current.max_accounts ? "consumed" : current.status;

  const patch: Record<string, unknown> = {
    entitlements_created_count: nextCount,
    updated_at: nowIso,
    status: nextStatus,
  };

  if (flow === "first_purchase") {
    patch.client_id = input.clientId;
    patch.first_checkout_used_at = current.first_checkout_used_at ?? nowIso;
  } else {
    patch.add_account_used_at = current.add_account_used_at ?? nowIso;
  }

  const { error: updateError } = await input.supabase
    .from("commercial_prod_test_checkout_authorizations")
    .update(patch)
    .eq("id", input.authorizationId)
    .eq("status", "active");

  if (updateError) {
    throw new Error("prod_test_authorization_update_failed");
  }
}

export function buildInternalTestClientMetadata(input: {
  email: string;
  displayName: string;
  checkoutSource?: CommercialCheckoutProvenance;
}) {
  return {
    contact_email: normalizeCheckoutEmail(input.email),
    display_name: input.displayName,
    service_page_url: "/instagram-growth",
    preferred_language: "fr",
    checkout_source: input.checkoutSource ?? "simulated_checkout",
    internal_test_client: true,
    billing_excluded: true,
    non_billable: true,
  };
}

export function buildInternalTestSubscriptionMetadata(input?: {
  checkoutSource?: CommercialCheckoutProvenance;
}) {
  return {
    source: input?.checkoutSource ?? "simulated_checkout",
    billing_mode: "per_account_entitlement",
    internal_test_client: true,
    billing_excluded: true,
    non_billable: true,
  };
}

export function isInternalTestClientMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return false;
  return (metadata as Record<string, unknown>).internal_test_client === true;
}

export type RedactedProdTestAuthorizationStatus = {
  id: string;
  emailHint: string;
  status: ProdTestCheckoutAuthorizationRow["status"];
  expiresAt: string;
  maxAccounts: number;
  entitlementsCreatedCount: number;
  firstCheckoutUsed: boolean;
  addAccountUsed: boolean;
  hasLinkedClient: boolean;
  nonBillable: true;
  paymentCollected: false;
  authorizedFlows: ProdTestCheckoutFlow[];
};

export function redactProdTestAuthorizationStatus(
  row: ProdTestCheckoutAuthorizationRow,
): RedactedProdTestAuthorizationStatus {
  const effectiveStatus = row.status === "active" && isProdTestCheckoutAuthorizationExpired(row)
    ? "expired"
    : row.status;
  return {
    id: row.id,
    emailHint: row.email_hint,
    status: effectiveStatus,
    expiresAt: row.expires_at,
    maxAccounts: row.max_accounts,
    entitlementsCreatedCount: row.entitlements_created_count,
    firstCheckoutUsed: Boolean(row.first_checkout_used_at),
    addAccountUsed: Boolean(row.add_account_used_at),
    hasLinkedClient: Boolean(row.client_id),
    nonBillable: true,
    paymentCollected: false,
    authorizedFlows: row.authorized_flows.filter(
      (flow): flow is ProdTestCheckoutFlow => flow === "first_purchase" || flow === "new_account",
    ),
  };
}

export async function resolveProdTestCheckoutClientIdByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<string | null> {
  const normalizedEmail = normalizeCheckoutEmail(email);
  const { data: users, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw new Error("authorization_tenant_lookup_failed");

  const authUser = (users.users ?? []).find(
    (user) => normalizeCheckoutEmail(user.email ?? "") === normalizedEmail,
  );
  if (!authUser?.id) return null;

  const { data, error } = await supabase
    .from("client_users")
    .select("client_id")
    .eq("auth_user_id", authUser.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(2);
  if (error) throw new Error("authorization_tenant_lookup_failed");

  const clientIds = [...new Set((data ?? []).map((row) => readString(row.client_id)).filter(Boolean))];
  if (clientIds.length > 1) throw new Error("authorization_tenant_ambiguous");
  return clientIds[0] ?? null;
}

function scopesAreCompatible(existing: ProdTestCheckoutAuthorizationRow, requested: ProdTestCheckoutFlow[]) {
  return requested.every((flow) => existing.authorized_flows.includes(flow));
}

async function terminalizeAuthorization(input: {
  supabase: SupabaseClient;
  authorization: ProdTestCheckoutAuthorizationRow;
  status: "expired" | "consumed";
  now: Date;
}) {
  const { error } = await input.supabase
    .from("commercial_prod_test_checkout_authorizations")
    .update({ status: input.status, updated_at: input.now.toISOString() })
    .eq("id", input.authorization.id)
    .eq("status", "active");
  if (error) throw new Error("prod_test_authorization_terminalize_failed");
}

export async function createProdTestCheckoutAuthorization(input: {
  supabase: SupabaseClient;
  email: string;
  createdByAuthUserId: string;
  expiresAt: Date;
  maxAccounts?: number;
  planKey?: PlanKey | null;
  billingIntervalMonths?: BillingIntervalMonths | null;
  authorizedFlows?: ProdTestCheckoutFlow[];
  clientId?: string | null;
  adminConfirmationAcknowledged: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<{
  authorization: RedactedProdTestAuthorizationStatus;
  action: ProdTestCheckoutAuthorizationAction;
}> {
  if (!input.adminConfirmationAcknowledged) {
    throw new Error("admin_confirmation_required");
  }
  if (!isProductionCheckoutEnvironment(input.env)) {
    throw new Error("production_environment_required");
  }

  const normalizedEmail = normalizeCheckoutEmail(input.email);
  if (!normalizedEmail.includes("@")) {
    throw new Error("invalid_email");
  }

  const now = input.now ?? new Date();
  const requestedFlows = input.authorizedFlows ?? ["first_purchase", "new_account"];
  const requestedClientId = readString(input.clientId) || null;
  const existing = await findLatestProdTestCheckoutAuthorization(input.supabase, normalizedEmail);
  if (existing?.client_id && requestedClientId && existing.client_id !== requestedClientId) {
    throw new Error("authorization_tenant_mismatch");
  }
  const inheritedClientId = requestedClientId ?? existing?.client_id ?? null;

  if (existing?.status === "active") {
    if (isProdTestCheckoutAuthorizationExpired(existing, now)) {
      await terminalizeAuthorization({ supabase: input.supabase, authorization: existing, status: "expired", now });
    } else if (existing.entitlements_created_count >= existing.max_accounts) {
      await terminalizeAuthorization({ supabase: input.supabase, authorization: existing, status: "consumed", now });
    } else {
      if (!scopesAreCompatible(existing, requestedFlows)) {
        throw new Error("authorization_scope_mismatch");
      }
      if (
        (existing.plan_key && existing.plan_key !== (input.planKey ?? null))
        || (existing.billing_interval_months != null
          && existing.billing_interval_months !== (input.billingIntervalMonths ?? null))
      ) {
        throw new Error("authorization_scope_mismatch");
      }

      const requestedExpiry = input.expiresAt.getTime();
      const currentExpiry = new Date(existing.expires_at).getTime();
      const patch: Record<string, unknown> = {};
      if (requestedExpiry > currentExpiry) patch.expires_at = input.expiresAt.toISOString();
      if (!existing.client_id && requestedClientId) patch.client_id = requestedClientId;

      if (Object.keys(patch).length === 0) {
        return { authorization: redactProdTestAuthorizationStatus(existing), action: "reused" };
      }

      patch.updated_at = now.toISOString();
      const { data, error } = await input.supabase
        .from("commercial_prod_test_checkout_authorizations")
        .update(patch)
        .eq("id", existing.id)
        .eq("status", "active")
        .select("*")
        .single<ProdTestCheckoutAuthorizationRow>();
      if (error || !data?.id) throw new Error("prod_test_authorization_renew_failed");
      return { authorization: redactProdTestAuthorizationStatus(data), action: "renewed" };
    }
  }

  const payload = {
    email_hash: hashProdTestCheckoutEmail(normalizedEmail),
    email_hint: redactEmailHint(normalizedEmail),
    authorized_flows: requestedFlows,
    max_accounts: input.maxAccounts ?? 1,
    plan_key: input.planKey ?? null,
    billing_interval_months: input.billingIntervalMonths ?? null,
    expires_at: input.expiresAt.toISOString(),
    status: "active",
    client_id: inheritedClientId,
    created_by_auth_user_id: input.createdByAuthUserId,
    admin_confirmation_acknowledged: true,
    metadata: {
      purpose: "agency_tenant_internal_test",
    },
  };

  const { data, error } = await input.supabase
    .from("commercial_prod_test_checkout_authorizations")
    .insert(payload)
    .select("*")
    .single<ProdTestCheckoutAuthorizationRow>();

  if (error || !data?.id) {
    throw new Error("prod_test_authorization_create_failed");
  }

  return { authorization: redactProdTestAuthorizationStatus(data), action: "created" };
}
