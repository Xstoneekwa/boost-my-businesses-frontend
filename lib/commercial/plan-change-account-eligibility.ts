import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export type PlanChangeAccountEligibilityErrorCode =
  | "account_not_found"
  | "account_client_mismatch"
  | "entitlement_not_found"
  | "entitlement_account_mismatch"
  | "entitlement_not_consumed"
  | "entitlement_reserved"
  | "source_inactive"
  | "account_paused"
  | "account_cancelled"
  | "account_needs_assistance"
  | "account_ineligible";

const BLOCKED_ADMIN_STATUSES = new Set([
  "paused",
  "needs_assistance",
  "cancelled",
  "pending_cancellation",
  "canceled",
]);

export async function assertPlanChangeAccountEligible(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    accountId: string;
    sourceEntitlementId?: string | null;
  },
): Promise<
  | { ok: true; accountId: string; sourceEntitlementId: string }
  | { ok: false; code: PlanChangeAccountEligibilityErrorCode }
> {
  const clientId = readString(input.clientId);
  const accountId = readString(input.accountId);
  if (!clientId || !accountId) {
    return { ok: false, code: "account_not_found" };
  }

  const { data: link, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,client_id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<Row>();

  if (linkError || !link?.account_id) {
    return { ok: false, code: "account_client_mismatch" };
  }

  const { data: accountRow, error: accountError } = await supabase
    .from("ig_accounts")
    .select("id,status,admin_lifecycle_status")
    .eq("id", accountId)
    .limit(1)
    .maybeSingle<Row>();

  if (accountError || !accountRow?.id) {
    return { ok: false, code: "account_not_found" };
  }

  const status = readString(accountRow.status, "active").toLowerCase();
  const adminStatus = readString(accountRow.admin_lifecycle_status, status).toLowerCase();
  if (adminStatus === "paused") return { ok: false, code: "account_paused" };
  if (adminStatus === "needs_assistance") return { ok: false, code: "account_needs_assistance" };
  if (BLOCKED_ADMIN_STATUSES.has(adminStatus) || status === "cancelled" || status === "canceled") {
    return { ok: false, code: "account_cancelled" };
  }
  if (["archived", "trashed", "deleted"].includes(status)) {
    return { ok: false, code: "account_ineligible" };
  }

  const entitlementQuery = supabase
    .from("client_account_entitlements")
    .select("id,client_id,account_id,status,checkout_session_id,plan_key")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .order("consumed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: entitlementRows, error: entitlementError } = await entitlementQuery;
  if (entitlementError || !Array.isArray(entitlementRows) || !entitlementRows.length) {
    return { ok: false, code: "entitlement_not_found" };
  }

  const requestedEntitlementId = readString(input.sourceEntitlementId);
  const entitlement = (entitlementRows as Row[]).find((row) => {
    if (requestedEntitlementId) return readString(row.id) === requestedEntitlementId;
    return readString(row.status) === "entitlement_consumed";
  });

  if (!entitlement?.id) {
    const reserved = (entitlementRows as Row[]).some((row) => readString(row.status) === "entitlement_reserved");
    if (reserved) return { ok: false, code: "entitlement_reserved" };
    return { ok: false, code: "entitlement_not_found" };
  }

  if (readString(entitlement.account_id) !== accountId) {
    return { ok: false, code: "entitlement_account_mismatch" };
  }

  if (readString(entitlement.status) === "entitlement_reserved") {
    return { ok: false, code: "entitlement_reserved" };
  }

  if (readString(entitlement.status) !== "entitlement_consumed") {
    return { ok: false, code: "entitlement_not_consumed" };
  }

  if (requestedEntitlementId && readString(entitlement.id) !== requestedEntitlementId) {
    return { ok: false, code: "entitlement_account_mismatch" };
  }

  return {
    ok: true,
    accountId,
    sourceEntitlementId: readString(entitlement.id),
  };
}
