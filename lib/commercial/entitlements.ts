import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntitlementStatus } from "./catalog";

type Row = Record<string, unknown>;

export type ClientAccountEntitlementRow = {
  id: string;
  clientId: string;
  checkoutSessionId: string;
  planKey: string;
  commercialPackageCode: string;
  billingIntervalMonths: number;
  outreachAddonKey: string | null;
  outreachVariant: string | null;
  backendAddonCode: string | null;
  appliedDiscountPercent: number;
  appliedDiscountType: string;
  packMonthlyDiscountedCents: number;
  packPeriodTotalCents: number;
  outreachMonthlyDiscountedCents: number | null;
  outreachPeriodTotalCents: number | null;
  totalPeriodCents: number;
  catalogSnapshot: Row;
  status: EntitlementStatus;
  accountId: string | null;
  consumedAt: string | null;
  metadata: Row;
  createdAt: string;
  updatedAt: string;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapEntitlementRow(row: Row): ClientAccountEntitlementRow {
  return {
    id: readString(row.id),
    clientId: readString(row.client_id),
    checkoutSessionId: readString(row.checkout_session_id),
    planKey: readString(row.plan_key),
    commercialPackageCode: readString(row.commercial_package_code),
    billingIntervalMonths: readNumber(row.billing_interval_months, 1),
    outreachAddonKey: readString(row.outreach_addon_key) || null,
    outreachVariant: readString(row.outreach_variant) || null,
    backendAddonCode: readString(row.backend_addon_code) || null,
    appliedDiscountPercent: readNumber(row.applied_discount_percent),
    appliedDiscountType: readString(row.applied_discount_type, "none"),
    packMonthlyDiscountedCents: readNumber(row.pack_monthly_discounted_cents),
    packPeriodTotalCents: readNumber(row.pack_period_total_cents),
    outreachMonthlyDiscountedCents: row.outreach_monthly_discounted_cents == null
      ? null
      : readNumber(row.outreach_monthly_discounted_cents),
    outreachPeriodTotalCents: row.outreach_period_total_cents == null
      ? null
      : readNumber(row.outreach_period_total_cents),
    totalPeriodCents: readNumber(row.total_period_cents),
    catalogSnapshot: (row.catalog_snapshot && typeof row.catalog_snapshot === "object" && !Array.isArray(row.catalog_snapshot))
      ? row.catalog_snapshot as Row
      : {},
    status: readString(row.status, "entitlement_reserved") as EntitlementStatus,
    accountId: readString(row.account_id) || null,
    consumedAt: readString(row.consumed_at) || null,
    metadata: (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata))
      ? row.metadata as Row
      : {},
    createdAt: readString(row.created_at),
    updatedAt: readString(row.updated_at),
  };
}

export async function countReservedEntitlementsForClient(supabase: SupabaseClient, clientId: string) {
  const { count, error } = await supabase
    .from("client_account_entitlements")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("status", "entitlement_reserved");
  if (error) throw new Error("entitlement_count_failed");
  return count ?? 0;
}

export async function countLinkedInstagramAccountsForClient(supabase: SupabaseClient, clientId: string) {
  const { count, error } = await supabase
    .from("client_instagram_accounts")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (error) throw new Error("client_account_count_failed");
  return count ?? 0;
}

export async function getReservedEntitlementForClient(supabase: SupabaseClient, clientId: string) {
  const { data, error } = await supabase
    .from("client_account_entitlements")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "entitlement_reserved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw new Error("entitlement_lookup_failed");
  if (data?.id) return mapEntitlementRow(data);

  const { data: reclaimable, error: reclaimableError } = await supabase
    .from("client_account_entitlements")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "entitlement_consumed")
    .is("account_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<Row>();
  if (reclaimableError) throw new Error("entitlement_lookup_failed");
  if (!reclaimable?.id) return null;

  const now = new Date().toISOString();
  const { data: promoted, error: promoteError } = await supabase
    .from("client_account_entitlements")
    .update({
      status: "entitlement_reserved",
      consumed_at: null,
      updated_at: now,
    })
    .eq("id", readString(reclaimable.id))
    .eq("client_id", clientId)
    .eq("status", "entitlement_consumed")
    .is("account_id", null)
    .select("*")
    .maybeSingle<Row>();
  if (promoteError) throw new Error("entitlement_reclaim_failed");
  return promoted?.id ? mapEntitlementRow(promoted) : null;
}

export async function getEntitlementById(supabase: SupabaseClient, entitlementId: string) {
  const { data, error } = await supabase
    .from("client_account_entitlements")
    .select("*")
    .eq("id", entitlementId)
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw new Error("entitlement_lookup_failed");
  return data?.id ? mapEntitlementRow(data) : null;
}

export async function markEntitlementConsumed(
  supabase: SupabaseClient,
  input: { entitlementId: string; accountId: string },
) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("client_account_entitlements")
    .update({
      status: "entitlement_consumed",
      account_id: input.accountId,
      consumed_at: now,
      updated_at: now,
    })
    .eq("id", input.entitlementId)
    .eq("status", "entitlement_reserved")
    .select("*")
    .maybeSingle<Row>();
  if (error) throw new Error("entitlement_consume_failed");
  if (!data?.id) throw new Error("entitlement_not_reserved");
  return mapEntitlementRow(data);
}

export async function insertCheckoutAuditEvent(
  supabase: SupabaseClient,
  input: {
    checkoutSessionId?: string | null;
    entitlementId?: string | null;
    eventType: string;
    actorEmail?: string | null;
    clientId?: string | null;
    payload?: Row;
  },
) {
  const { error } = await supabase.from("commercial_checkout_audit_events").insert({
    checkout_session_id: input.checkoutSessionId ?? null,
    entitlement_id: input.entitlementId ?? null,
    event_type: input.eventType,
    actor_email: input.actorEmail ?? null,
    client_id: input.clientId ?? null,
    payload: input.payload ?? {},
  });
  if (error) {
    return {
      ok: false as const,
      postgresCode: typeof error.code === "string" ? error.code : undefined,
    };
  }
  return { ok: true as const };
}

export function entitlementToAddProfileInput(entitlement: ClientAccountEntitlementRow) {
  const addons: Array<"extra_outreach_volume"> = entitlement.outreachAddonKey ? ["extra_outreach_volume"] : [];
  return {
    commercialPackage: entitlement.commercialPackageCode as "growth" | "pro" | "premium",
    addons,
    outreachVariant: entitlement.outreachVariant,
    entitlementId: entitlement.id,
    planKey: entitlement.planKey,
    outreachAddonKey: entitlement.outreachAddonKey,
  };
}
