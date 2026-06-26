import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import type { createSupabaseClient } from "@/lib/supabase";
import { resolveAccountPackageCode } from "@/lib/instagram-client/resolve-account-package-code";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;

export type AccountWelcomeCapacitySource = "account_entitlement" | "account_package" | "none";

export type AccountWelcomeCapacity = {
  active: boolean;
  source: AccountWelcomeCapacitySource;
  packageCode: string;
};

function entitlementActiveNow(row: SupabaseRecord) {
  if (row.active !== true) return false;
  const validUntil = readString(row.valid_until, "").trim();
  if (!validUntil) return true;
  const time = new Date(validUntil).getTime();
  return Number.isFinite(time) && time > Date.now();
}

/** Product rule: Welcome DM is included on Pro/Premium (and custom alias), not Growth. */
export function packageIncludesWelcomeDm(packageCode: string) {
  const normalized = readString(packageCode, "growth").toLowerCase();
  return normalized === "pro" || normalized === "premium" || normalized === "custom";
}

async function hasAccountScopedWelcomeEntitlement(supabase: SupabaseClient, accountId: string) {
  const { data: rows, error } = await supabase
    .from("client_entitlements")
    .select("active,valid_until")
    .eq("account_id", accountId)
    .eq("feature_code", "welcome")
    .eq("active", true)
    .limit(10);
  if (error) return null;
  return (rows ?? []).some((row) => entitlementActiveNow(row as SupabaseRecord));
}

/**
 * Canonical account-scoped Welcome DM capacity.
 * Uses the same commercial package source as account badges, never client-global checkout alone.
 */
export async function resolveAccountWelcomeServiceActive(
  supabase: SupabaseClient,
  accountId: string,
): Promise<AccountWelcomeCapacity> {
  const packageCode = await resolveAccountPackageCode(accountId);
  const entitlement = await hasAccountScopedWelcomeEntitlement(supabase, accountId);
  if (entitlement === null) {
    return { active: false, source: "none", packageCode };
  }
  if (entitlement === true) {
    return { active: true, source: "account_entitlement", packageCode };
  }
  if (packageIncludesWelcomeDm(packageCode)) {
    return { active: true, source: "account_package", packageCode };
  }
  return { active: false, source: "none", packageCode };
}

export function welcomeCapacityStatusLabel(capacity: AccountWelcomeCapacity) {
  if (!capacity.active) return "Missing";
  return capacity.source === "account_entitlement" ? "Active" : "Included";
}
