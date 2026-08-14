import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntitlementById, markEntitlementConsumed } from "../entitlements.ts";
import type { PlanKey } from "../catalog.ts";

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

const INELIGIBLE_ACCOUNT_STATUSES = new Set([
  "archived",
  "trashed",
  "deleted",
  "cancelled",
  "canceled",
]);

export async function assertExistingAccountStripeCheckoutTarget(
  supabase: SupabaseClient,
  input: { clientId: string; accountId: string; planKey: PlanKey },
) {
  const clientId = readString(input.clientId);
  const accountId = readString(input.accountId);
  if (!clientId || !accountId) {
    return { ok: false as const, code: "target_account_required" as const };
  }

  const { data: link, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id,client_id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<Row>();
  if (linkError || !link?.account_id) {
    return { ok: false as const, code: "target_account_client_mismatch" as const };
  }

  const { data: account, error: accountError } = await supabase
    .from("ig_accounts")
    .select("id,status,admin_lifecycle_status")
    .eq("id", accountId)
    .limit(1)
    .maybeSingle<Row>();
  if (accountError || !account?.id) {
    return { ok: false as const, code: "target_account_not_found" as const };
  }
  const accountStatus = readString(account.status).toLowerCase();
  const lifecycleStatus = readString(account.admin_lifecycle_status).toLowerCase();
  if (INELIGIBLE_ACCOUNT_STATUSES.has(accountStatus) || INELIGIBLE_ACCOUNT_STATUSES.has(lifecycleStatus)) {
    return { ok: false as const, code: "target_account_ineligible" as const };
  }

  const { data: packageSummary, error: packageError } = await supabase
    .from("account_package_summary")
    .select("commercial_package_code")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<Row>();
  if (packageError || readString(packageSummary?.commercial_package_code).toLowerCase() !== input.planKey) {
    return { ok: false as const, code: "target_account_package_mismatch" as const };
  }

  const { data: entitlementRows, error: entitlementError } = await supabase
    .from("client_account_entitlements")
    .select("id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .eq("status", "entitlement_consumed")
    .limit(1);
  if (entitlementError) {
    return { ok: false as const, code: "target_entitlement_lookup_failed" as const };
  }
  if (Array.isArray(entitlementRows) && entitlementRows.length > 0) {
    return { ok: false as const, code: "target_modern_entitlement_exists" as const };
  }

  const { data: subscriptionRows, error: subscriptionError } = await supabase
    .from("commercial_stripe_subscriptions")
    .select("id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .limit(1);
  if (subscriptionError) {
    return { ok: false as const, code: "target_subscription_lookup_failed" as const };
  }
  if (Array.isArray(subscriptionRows) && subscriptionRows.length > 0) {
    return { ok: false as const, code: "target_modern_subscription_exists" as const };
  }

  return { ok: true as const, clientId, accountId };
}

export async function bindActivatedEntitlementToExistingAccount(
  supabase: SupabaseClient,
  input: { entitlementId: string; accountId: string; clientId: string },
) {
  const entitlement = await getEntitlementById(supabase, input.entitlementId);
  if (!entitlement || entitlement.clientId !== input.clientId) {
    throw new Error("entitlement_client_mismatch");
  }
  if (entitlement.status === "entitlement_consumed") {
    if (entitlement.accountId !== input.accountId) throw new Error("entitlement_account_mismatch");
    return entitlement;
  }
  if (entitlement.status !== "entitlement_reserved" || entitlement.accountId) {
    throw new Error("entitlement_not_bindable");
  }
  return markEntitlementConsumed(supabase, {
    entitlementId: input.entitlementId,
    accountId: input.accountId,
  });
}
