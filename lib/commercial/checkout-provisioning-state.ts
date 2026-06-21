import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export const PROTECTED_CHECKOUT_CLIENT_IDS = new Set([
  "c37c9143-ee14-4c9a-9a60-226759241733",
]);

export type ProvisioningStage =
  | "auth"
  | "client"
  | "tenant_users"
  | "client_users"
  | "subscription"
  | "checkout_session"
  | "entitlement"
  | "audit";

export type ProvisioningStageMap = Record<ProvisioningStage, boolean>;

export type IncompleteCheckoutBlockReason =
  | "storage_error"
  | "protected_client"
  | "client_not_simulated_checkout"
  | "client_email_mismatch"
  | "client_ambiguous"
  | "tenant_auth_mismatch"
  | "tenant_points_to_other_client"
  | "client_has_instagram_account"
  | "client_has_consumed_entitlement"
  | "client_has_multiple_entitlements"
  | "checkout_already_complete"
  | "unsafe_client_dependencies";

export type ProvisioningInspection =
  | {
    ok: true;
    authUserId: string;
    clientId: string;
    stages: ProvisioningStageMap;
    checkoutSessionId: string | null;
    entitlementId: string | null;
    isComplete: boolean;
    isResumableIncomplete: boolean;
    resumeMode: "none" | "link_orphan_client" | "complete_partial" | "replay_complete";
  }
  | {
    ok: false;
    reason: IncompleteCheckoutBlockReason;
    storageQuery?: string;
    postgresCode?: string;
    storageMessage?: string;
  };

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function storageFailure(query: string, error: unknown): Extract<ProvisioningInspection, { ok: false }> {
  const postgresCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
  const storageMessage = error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message.slice(0, 240)
    : undefined;
  return {
    ok: false,
    reason: "storage_error",
    storageQuery: query,
    postgresCode,
    storageMessage,
  };
}

export function isSimulatedCheckoutClientMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return readString((metadata as Row).checkout_source) === "simulated_checkout";
}

export function clientContactEmail(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return readString((metadata as Row).contact_email).toLowerCase();
}

export function buildEmptyStageMap(): ProvisioningStageMap {
  return {
    auth: false,
    client: false,
    tenant_users: false,
    client_users: false,
    subscription: false,
    checkout_session: false,
    entitlement: false,
    audit: false,
  };
}

export function deriveResumeMode(stages: ProvisioningStageMap): "none" | "link_orphan_client" | "complete_partial" {
  if (stages.tenant_users) return "complete_partial";
  if (stages.client) return "link_orphan_client";
  return "none";
}

export function isActivationChainComplete(stages: ProvisioningStageMap) {
  return (
    stages.auth
    && stages.client
    && stages.tenant_users
    && stages.client_users
    && stages.subscription
    && stages.checkout_session
    && stages.entitlement
    && stages.audit
  );
}

async function findSimulatedCheckoutClientsForEmail(supabase: SupabaseClient, email: string) {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await supabase
    .from("clients")
    .select("id,status,metadata")
    .eq("status", "active")
    .filter("metadata->>contact_email", "eq", normalized);
  if (error) return storageFailure("clients.find_simulated_checkout_by_email", error);
  const clients = (data ?? []).filter((row) => isSimulatedCheckoutClientMetadata(row.metadata));
  return {
    ok: true as const,
    clients: clients.map((row) => ({
      clientId: readString(row.id),
      metadata: row.metadata as Row,
    })),
  };
}

function firstStorageFailure(
  checks: Array<[string, { error: unknown | null }]>,
): Extract<ProvisioningInspection, { ok: false }> | null {
  for (const [query, result] of checks) {
    if (result.error) return storageFailure(query, result.error);
  }
  return null;
}

async function inspectClientProvisioning(
  supabase: SupabaseClient,
  input: { authUserId: string; clientId: string },
) {
  const { authUserId, clientId } = input;
  const stages = buildEmptyStageMap();
  stages.auth = true;
  stages.client = true;

  const [
    tenantUser,
    clientUser,
    subscription,
    sessions,
    entitlements,
    linkedInstagramAccounts,
    auditEvents,
  ] = await Promise.all([
    supabase
      .from("tenant_users")
      .select("user_id,tenant_id,role")
      .eq("user_id", authUserId)
      .eq("tenant_id", clientId)
      .maybeSingle<Row>(),
    supabase
      .from("client_users")
      .select("id")
      .eq("client_id", clientId)
      .eq("auth_user_id", authUserId)
      .maybeSingle<Row>(),
    supabase
      .from("client_subscriptions")
      .select("id")
      .eq("client_id", clientId)
      .eq("status", "active")
      .maybeSingle<Row>(),
    supabase
      .from("commercial_checkout_sessions")
      .select("id,status,idempotency_key")
      .eq("client_id", clientId)
      .eq("status", "checkout_activated_test")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("client_account_entitlements")
      .select("id,status,checkout_session_id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("client_instagram_accounts")
      .select("id")
      .eq("client_id", clientId)
      .limit(1),
    supabase
      .from("commercial_checkout_audit_events")
      .select("id,checkout_session_id")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const storageError = firstStorageFailure([
    ["tenant_users.by_auth_and_client", tenantUser],
    ["client_users.by_auth_and_client", clientUser],
    ["client_subscriptions.active_by_client", subscription],
    ["commercial_checkout_sessions.by_client", sessions],
    ["client_account_entitlements.by_client", entitlements],
    ["client_instagram_accounts.by_client", linkedInstagramAccounts],
    ["commercial_checkout_audit_events.by_client", auditEvents],
  ]);
  if (storageError) return storageError;

  if ((linkedInstagramAccounts.data ?? []).length > 0) {
    return { ok: false as const, reason: "client_has_instagram_account" as const };
  }

  const entitlementRows = entitlements.data ?? [];
  if (entitlementRows.some((row) => readString(row.status) === "entitlement_consumed")) {
    return { ok: false as const, reason: "client_has_consumed_entitlement" as const };
  }
  const reservedEntitlements = entitlementRows.filter((row) => readString(row.status) === "entitlement_reserved");
  if (reservedEntitlements.length > 1) {
    return { ok: false as const, reason: "client_has_multiple_entitlements" as const };
  }

  stages.tenant_users = Boolean(tenantUser.data?.user_id);
  stages.client_users = Boolean(clientUser.data?.id);
  stages.subscription = Boolean(subscription.data?.id);

  const sessionRow = (sessions.data ?? [])[0];
  const entitlementRow = reservedEntitlements[0] ?? entitlementRows[0];
  stages.checkout_session = Boolean(sessionRow?.id);
  stages.entitlement = Boolean(entitlementRow?.id && readString(entitlementRow.status) === "entitlement_reserved");

  const checkoutSessionId = readString(sessionRow?.id) || null;
  const entitlementId = readString(entitlementRow?.id) || null;
  if (checkoutSessionId) {
    const auditForSession = (auditEvents.data ?? []).some(
      (row) => readString(row.checkout_session_id) === checkoutSessionId,
    );
    stages.audit = auditForSession;
  }

  const isComplete = isActivationChainComplete(stages);
  const isResumableIncomplete = !isComplete && stages.client;

  return {
    ok: true as const,
    stages,
    checkoutSessionId,
    entitlementId,
    isComplete,
    isResumableIncomplete,
    resumeMode: isResumableIncomplete ? deriveResumeMode(stages) : "none" as const,
  };
}

export async function inspectSimulatedCheckoutProvisioning(
  supabase: SupabaseClient,
  input: { email: string; authUserId: string },
) {
  const email = input.email.trim().toLowerCase();
  if (PROTECTED_CHECKOUT_CLIENT_IDS.has(input.authUserId)) {
    return { ok: false as const, reason: "protected_client" as const };
  }

  const { data: tenantUserRow, error: tenantUserError } = await supabase
    .from("tenant_users")
    .select("user_id,tenant_id,role")
    .eq("user_id", input.authUserId)
    .maybeSingle<Row>();

  if (tenantUserError) return storageFailure("tenant_users.by_auth_user", tenantUserError);

  let clientId = readString(tenantUserRow?.tenant_id);

  if (!clientId) {
    const clientsResult = await findSimulatedCheckoutClientsForEmail(supabase, email);
    if (!clientsResult.ok) return clientsResult;
    if (clientsResult.clients.length === 0) {
      return { ok: false as const, reason: "client_ambiguous" as const };
    }
    if (clientsResult.clients.length > 1) {
      return { ok: false as const, reason: "client_ambiguous" as const };
    }
    clientId = clientsResult.clients[0].clientId;

    const { count: linkedTenantCount, error: linkedTenantError } = await supabase
      .from("tenant_users")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", clientId);
    if (linkedTenantError) return storageFailure("tenant_users.count_by_client", linkedTenantError);
    if ((linkedTenantCount ?? 0) > 0) {
      return { ok: false as const, reason: "unsafe_client_dependencies" as const };
    }
  } else if (readString(tenantUserRow?.user_id) !== input.authUserId) {
    return { ok: false as const, reason: "tenant_auth_mismatch" as const };
  }

  if (PROTECTED_CHECKOUT_CLIENT_IDS.has(clientId)) {
    return { ok: false as const, reason: "protected_client" as const };
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id,status,metadata")
    .eq("id", clientId)
    .maybeSingle<Row>();
  if (clientError || !client?.id || readString(client.status) !== "active") {
    return { ok: false as const, reason: "unsafe_client_dependencies" as const };
  }
  if (!isSimulatedCheckoutClientMetadata(client.metadata)) {
    return { ok: false as const, reason: "client_not_simulated_checkout" as const };
  }
  if (clientContactEmail(client.metadata) !== email) {
    return { ok: false as const, reason: "client_email_mismatch" as const };
  }

  const inspected = await inspectClientProvisioning(supabase, {
    authUserId: input.authUserId,
    clientId,
  });
  if (!inspected.ok) return inspected;

  if (inspected.isComplete) {
    const result: ProvisioningInspection = {
      ok: true,
      authUserId: input.authUserId,
      clientId,
      stages: inspected.stages,
      checkoutSessionId: inspected.checkoutSessionId,
      entitlementId: inspected.entitlementId,
      isComplete: true,
      isResumableIncomplete: false,
      resumeMode: "replay_complete",
    };
    return result;
  }
  if (!inspected.isResumableIncomplete) {
    return { ok: false as const, reason: "unsafe_client_dependencies" as const };
  }

  const result: ProvisioningInspection = {
    ok: true,
    authUserId: input.authUserId,
    clientId,
    stages: inspected.stages,
    checkoutSessionId: inspected.checkoutSessionId,
    entitlementId: inspected.entitlementId,
    isComplete: inspected.isComplete,
    isResumableIncomplete: inspected.isResumableIncomplete,
    resumeMode: inspected.resumeMode,
  };
  return result;
}

export async function findIncompleteCheckoutSessionForClient(
  supabase: SupabaseClient,
  clientId: string,
) {
  const { data: session, error } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,client_id,auth_user_id,status")
    .eq("client_id", clientId)
    .eq("status", "checkout_activated_test")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();
  if (error || !session?.id) return { kind: "missing" as const };

  const { data: entitlement, error: entitlementError } = await supabase
    .from("client_account_entitlements")
    .select("id")
    .eq("checkout_session_id", readString(session.id))
    .limit(1)
    .maybeSingle<Row>();
  if (entitlementError) return { kind: "storage_error" as const };
  if (!entitlement?.id) {
    return {
      kind: "partial" as const,
      checkoutSessionId: readString(session.id),
      clientId: readString(session.client_id),
      authUserId: readString(session.auth_user_id) || null,
    };
  }
  return { kind: "found" as const };
}
