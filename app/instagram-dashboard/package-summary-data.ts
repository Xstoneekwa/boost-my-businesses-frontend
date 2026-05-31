import { createSupabaseClient } from "@/lib/supabase";

type SupabaseRecord = Record<string, unknown>;

export type AccountPackageSummary = {
  accountId: string;
  commercialPackageCode: string | null;
  commercialPackageLabel: string;
  commercialAddonsLabel: string;
  outreachSourceLabel: string;
  entitlementSummary: string;
  runtimeProfilesLabel: string;
};

const PACKAGE_PENDING = "Package pending";
const ADDONS_NONE = "No add-ons";
const OUTREACH_PENDING = "pending_source_classification";
const RUNTIME_PENDING = "Runtime profile pending";
const RUNTIME_PROFILE_CODES = new Set(["full_cycle", "outreach_only", "account_session", "outreach_session"]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => readString(item)).filter(Boolean);
  const raw = readString(value);
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function displayCode(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function safePackageLabel(code: string | null, label: string | null) {
  const normalizedCode = (code ?? "").trim().toLowerCase();
  const normalizedLabel = (label ?? "").trim();
  if (normalizedCode && !RUNTIME_PROFILE_CODES.has(normalizedCode)) return normalizedLabel || displayCode(normalizedCode);
  if (normalizedLabel && !RUNTIME_PROFILE_CODES.has(normalizedLabel.toLowerCase())) return normalizedLabel;
  return PACKAGE_PENDING;
}

function emptySummary(accountId: string): AccountPackageSummary {
  return {
    accountId,
    commercialPackageCode: null,
    commercialPackageLabel: PACKAGE_PENDING,
    commercialAddonsLabel: ADDONS_NONE,
    outreachSourceLabel: OUTREACH_PENDING,
    entitlementSummary: "unknown",
    runtimeProfilesLabel: RUNTIME_PENDING,
  };
}

function mapSummaryRow(row: SupabaseRecord, accountId: string): AccountPackageSummary {
  const packageCode = readString(row.commercial_package_code || row.package_code) || null;
  const packageLabel = readString(row.commercial_package_label || row.package_label) || null;
  const addons = readStringArray(row.commercial_addons || row.addons || row.addon_codes);
  const entitlements = readStringArray(row.entitlements || row.entitlement_summary);
  const runtimeProfiles = readStringArray(row.runtime_profiles || row.runtime_profile_codes);
  const outreachSource = readString(row.outreach_job_source || row.outreach_source || row.outreach_variant, OUTREACH_PENDING);

  return {
    accountId,
    commercialPackageCode: packageCode,
    commercialPackageLabel: safePackageLabel(packageCode, packageLabel),
    commercialAddonsLabel: addons.length ? addons.map(displayCode).join(", ") : ADDONS_NONE,
    outreachSourceLabel: outreachSource || OUTREACH_PENDING,
    entitlementSummary: entitlements.length ? entitlements.join(", ") : "unknown",
    runtimeProfilesLabel: runtimeProfiles.length ? runtimeProfiles.join(", ") : RUNTIME_PENDING,
  };
}

function runtimeProfilesFromRows(rows: SupabaseRecord[]) {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const accountId = readString(row.account_id);
    if (!accountId) continue;
    const subscription = row.client_subscriptions;
    const subscriptionRows = Array.isArray(subscription) ? subscription : [subscription];
    for (const sub of subscriptionRows) {
      if (!sub || typeof sub !== "object" || Array.isArray(sub)) continue;
      const profile = readString((sub as SupabaseRecord).subscription_type);
      if (!profile) continue;
      if (!out.has(accountId)) out.set(accountId, new Set());
      out.get(accountId)?.add(profile);
    }
  }
  return out;
}

async function readAccountPackageSummary(accountIds: string[]) {
  if (!accountIds.length) return new Map<string, AccountPackageSummary>();
  const { data, error } = await createSupabaseClient()
    .from("account_package_summary")
    .select("account_id,commercial_package_code,commercial_package_label,commercial_addons,outreach_variant,outreach_job_source,entitlements,runtime_profiles")
    .in("account_id", accountIds)
    .limit(1000);

  if (error || !Array.isArray(data)) return new Map<string, AccountPackageSummary>();
  return new Map(
    (data as SupabaseRecord[])
      .map((row) => {
        const accountId = readString(row.account_id);
        return accountId ? [accountId, mapSummaryRow(row, accountId)] as const : null;
      })
      .filter((entry): entry is readonly [string, AccountPackageSummary] => Boolean(entry)),
  );
}

async function readRuntimeProfiles(accountIds: string[]) {
  if (!accountIds.length) return new Map<string, Set<string>>();
  const { data, error } = await createSupabaseClient()
    .from("client_subscription_accounts")
    .select("account_id,client_subscriptions(subscription_type,status)")
    .in("account_id", accountIds)
    .eq("status", "active")
    .limit(1000);

  if (error || !Array.isArray(data)) return new Map<string, Set<string>>();
  return runtimeProfilesFromRows(data as SupabaseRecord[]);
}

export async function getAccountPackageSummaries(accountIds: string[]) {
  const uniqueIds = [...new Set(accountIds.filter(Boolean))];
  const [summaryByAccount, runtimeProfiles] = await Promise.all([
    readAccountPackageSummary(uniqueIds),
    readRuntimeProfiles(uniqueIds),
  ]);

  for (const accountId of uniqueIds) {
    const summary = summaryByAccount.get(accountId) ?? emptySummary(accountId);
    const profiles = runtimeProfiles.get(accountId);
    if (profiles?.size) {
      summary.runtimeProfilesLabel = [...profiles].sort().join(", ");
    }
    summaryByAccount.set(accountId, summary);
  }

  return summaryByAccount;
}
