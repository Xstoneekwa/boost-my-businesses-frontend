import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccountPackageSummaries } from "../../app/instagram-dashboard/package-summary-data.ts";
import { clientVisiblePlanLabel } from "./plan-change-source.ts";
import { isPlanKey, type PlanKey } from "./catalog.ts";

type Row = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export type PlanChangeEligibleAccount = {
  accountId: string;
  username: string;
  currentPlanKey: PlanKey | null;
  currentPlanLabel: string;
  sourceEntitlementId: string | null;
  eligible: boolean;
  ineligibleCode: string | null;
};

function readMetadataString(metadata: unknown, key: string, fallback = "") {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return fallback;
  return readString((metadata as Row)[key], fallback);
}

export async function loadPlanChangeEligibleAccounts(
  supabase: SupabaseClient,
  clientId: string,
): Promise<PlanChangeEligibleAccount[]> {
  const normalizedClientId = readString(clientId);
  if (!normalizedClientId) return [];

  const { data: links, error: linksError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id")
    .eq("client_id", normalizedClientId)
    .limit(200);

  if (linksError || !Array.isArray(links) || !links.length) return [];

  const accountIds = [...new Set((links as Row[]).map((row) => readString(row.account_id)).filter(Boolean))];
  if (!accountIds.length) return [];

  const [{ data: accounts }, { data: entitlementRows }, packageSummaries] = await Promise.all([
    supabase.from("ig_accounts").select("id,username,status,admin_lifecycle_status").in("id", accountIds),
    supabase
      .from("client_account_entitlements")
      .select("id,account_id,status,plan_key,commercial_package_code")
      .eq("client_id", normalizedClientId)
      .in("account_id", accountIds)
      .in("status", ["entitlement_consumed", "entitlement_reserved"])
      .order("consumed_at", { ascending: false, nullsFirst: false }),
    getAccountPackageSummaries(accountIds),
  ]);

  const accountsById = new Map(
    (Array.isArray(accounts) ? accounts as Row[] : []).map((row) => [readString(row.id), row]),
  );
  const entitlementsByAccount = new Map<string, Row>();
  for (const row of Array.isArray(entitlementRows) ? entitlementRows as Row[] : []) {
    const accountId = readString(row.account_id);
    if (!accountId || entitlementsByAccount.has(accountId)) continue;
    entitlementsByAccount.set(accountId, row);
  }

  return accountIds.map((accountId) => {
    const account = accountsById.get(accountId);
    const entitlement = entitlementsByAccount.get(accountId);
    const packageSummary = packageSummaries.get(accountId);
    const planFromEntitlement = readString(entitlement?.plan_key || entitlement?.commercial_package_code).toLowerCase();
    const planFromPackage = readString(packageSummary?.commercialPackageCode).toLowerCase();
    const planKeyRaw = planFromEntitlement || planFromPackage;
    const currentPlanKey = isPlanKey(planKeyRaw) ? planKeyRaw : null;

    const status = readString(account?.status, "active").toLowerCase();
    const adminStatus = readString(account?.admin_lifecycle_status, status).toLowerCase();
    let eligible = true;
    let ineligibleCode: string | null = null;

    if (!account?.id) {
      eligible = false;
      ineligibleCode = "account_not_found";
    } else if (!entitlement || readString(entitlement.status) !== "entitlement_consumed") {
      eligible = false;
      ineligibleCode = readString(entitlement?.status) === "entitlement_reserved"
        ? "entitlement_reserved"
        : "entitlement_not_found";
    } else if (adminStatus === "paused") {
      eligible = false;
      ineligibleCode = "account_paused";
    } else if (adminStatus === "needs_assistance") {
      eligible = false;
      ineligibleCode = "account_needs_assistance";
    } else if (["cancelled", "pending_cancellation", "canceled"].includes(adminStatus) || status === "cancelled") {
      eligible = false;
      ineligibleCode = "account_cancelled";
    }

    return {
      accountId,
      username: readString(account?.username, "Instagram account").replace(/^@+/, ""),
      currentPlanKey,
      currentPlanLabel: currentPlanKey ? clientVisiblePlanLabel(currentPlanKey) : (packageSummary?.commercialPackageLabel || "—"),
      sourceEntitlementId: eligible ? readString(entitlement?.id) || null : null,
      eligible,
      ineligibleCode,
    };
  });
}
