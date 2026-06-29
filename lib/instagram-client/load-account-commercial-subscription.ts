import { createSupabaseClient } from "@/lib/supabase";
import { getAccountPackageSummaries } from "@/app/instagram-dashboard/package-summary-data";
import { COMMERCIAL_PLANS, type PlanKey } from "@/lib/commercial/catalog";
import {
  formatClientMonthlyPrice,
  isKnownCommercialPlanKey,
  projectClientSubscriptionDisplay,
  resolveClientCommercialPlanKey,
  resolveClientPlanLabel,
  resolveSubscriptionPeriodEnd,
  type ClientBillingDisplayMode,
} from "./client-subscription-projection";
import { readString } from "./guards";

type SupabaseRecord = Record<string, unknown>;

export type AccountCommercialSubscriptionDisplay = {
  accountId: string;
  username: string;
  planLabel: string;
  statusLabel: string;
  priceLabel: string;
  growthLabel: string;
  supportLabel: string;
  billingDisplayMode: ClientBillingDisplayMode;
  billingDateIso: string;
};

function readMetadataString(metadata: unknown, key: string, fallback = "") {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return fallback;
  return readString((metadata as SupabaseRecord)[key], fallback);
}

function catalogGrowthLabel(planKey: PlanKey, lang: "fr" | "en") {
  return lang === "fr"
    ? COMMERCIAL_PLANS[planKey].growthEstimateLabelFr
    : COMMERCIAL_PLANS[planKey].growthEstimateLabelEn;
}

function pendingLabel(lang: "fr" | "en") {
  return lang === "fr" ? "Données en cours" : "Data pending";
}

function availableSoonLabel(lang: "fr" | "en", kind: "amount" | "period") {
  if (lang === "fr") {
    return kind === "amount" ? "Disponible prochainement" : "Données en cours";
  }
  return kind === "amount" ? "Available soon" : "Data pending";
}

export async function loadAccountCommercialSubscriptionDisplay(input: {
  clientId: string;
  accountId: string;
  lang: "fr" | "en";
}): Promise<AccountCommercialSubscriptionDisplay | null> {
  const clientId = input.clientId.trim();
  const accountId = input.accountId.trim();
  if (!clientId || !accountId) return null;

  const supabase = createSupabaseClient();
  const { data: link, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("account_id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();

  if (linkError || !link?.account_id) return null;

  const [{ data: account }, packageSummaries, { data: entitlementRows }, { data: subscriptionAccountRows }] = await Promise.all([
    supabase
      .from("ig_accounts")
      .select("id,username")
      .eq("id", accountId)
      .limit(1)
      .maybeSingle<SupabaseRecord>(),
    getAccountPackageSummaries([accountId]),
    supabase
      .from("client_account_entitlements")
      .select("plan_key,commercial_package_code,billing_interval_months,pack_monthly_discounted_cents,consumed_at,created_at,metadata,status")
      .eq("client_id", clientId)
      .eq("account_id", accountId)
      .in("status", ["entitlement_consumed", "entitlement_reserved"])
      .order("consumed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("client_subscription_accounts")
      .select("subscription_id,client_subscriptions(status,starts_at,metadata)")
      .eq("account_id", accountId)
      .eq("status", "active")
      .limit(1),
  ]);

  if (!account?.id) return null;

  const packageSummary = packageSummaries.get(accountId);
  const packageCode = readString(packageSummary?.commercialPackageCode).toLowerCase();
  const entitlement = Array.isArray(entitlementRows) ? entitlementRows[0] as SupabaseRecord | undefined : undefined;
  const subscriptionAccount = Array.isArray(subscriptionAccountRows) ? subscriptionAccountRows[0] as SupabaseRecord | undefined : undefined;
  const subscription = subscriptionAccount?.client_subscriptions;
  const subscriptionRow = Array.isArray(subscription) ? subscription[0] as SupabaseRecord | undefined : subscription as SupabaseRecord | undefined;
  const subscriptionMetadata = subscriptionRow?.metadata && typeof subscriptionRow.metadata === "object"
    ? subscriptionRow.metadata as SupabaseRecord
    : null;
  const entitlementMetadata = entitlement?.metadata && typeof entitlement.metadata === "object"
    ? entitlement.metadata as SupabaseRecord
    : null;

  const commercial = entitlement ? {
    planKey: readString(entitlement.plan_key).toLowerCase() || null,
    commercialPackageCode: readString(entitlement.commercial_package_code).toLowerCase() || null,
    checkoutSessionPlanKey: null,
    billingIntervalMonths: Number(entitlement.billing_interval_months) || null,
    periodStartAt: readString(entitlement.consumed_at) || readString(entitlement.created_at) || readString(subscriptionRow?.starts_at) || null,
    periodEndAt: null,
    growthEstimateLabel: readMetadataString(entitlementMetadata, "growth_estimate_label") || null,
    monthlyPriceCents: Number(entitlement.pack_monthly_discounted_cents) || null,
  } : null;

  const resolved = resolveClientCommercialPlanKey({
    entitlementPlanKey: commercial?.planKey ?? null,
    entitlementCommercialPackageCode: commercial?.commercialPackageCode ?? null,
    checkoutSessionPlanKey: null,
    linkedAccountPackageCodes: packageCode ? [packageCode] : [],
    subscriptionPlanKey: readMetadataString(subscriptionMetadata, "plan_key")
      || readMetadataString(subscriptionMetadata, "commercial_package_code"),
  });

  const projection = projectClientSubscriptionDisplay({
    commercial,
    subscriptionStartsAt: readString(subscriptionRow?.starts_at) || null,
    clientCreatedAt: null,
    clientMetadata: subscriptionMetadata,
    preferredLanguage: input.lang,
    linkedAccountPackageCodes: packageCode ? [packageCode] : [],
    subscriptionPlanKey: readMetadataString(subscriptionMetadata, "plan_key")
      || readMetadataString(subscriptionMetadata, "commercial_package_code"),
  });

  const planKey = resolved.planKey;
  const planLabel = packageSummary?.commercialPackageLabel
    && packageSummary.commercialPackageLabel !== "Package pending"
    ? packageSummary.commercialPackageLabel
    : resolveClientPlanLabel(planKey, input.lang);

  const priceLabel = projection.subscriptionPriceLabel
    || formatClientMonthlyPrice(planKey, commercial?.monthlyPriceCents ?? null, input.lang)
    || availableSoonLabel(input.lang, "amount");

  const growthLabel = readMetadataString(entitlementMetadata, "growth_estimate_label")
    || projection.subscriptionGrowthLabel
    || (planKey && isKnownCommercialPlanKey(planKey) ? catalogGrowthLabel(planKey, input.lang) : "")
    || pendingLabel(input.lang);

  const supportLabel = readMetadataString(entitlementMetadata, "support_label") || pendingLabel(input.lang);

  const periodEndAt = resolveSubscriptionPeriodEnd({
    periodStartAt: commercial?.periodStartAt ?? (readString(subscriptionRow?.starts_at) || null),
    billingIntervalMonths: commercial?.billingIntervalMonths ?? null,
    explicitPeriodEndAt: readMetadataString(subscriptionMetadata, "period_end_at"),
  });

  const billingDateIso = projection.billingDisplayMode === "next_billing"
    ? (readMetadataString(subscriptionMetadata, "next_billing_at") || periodEndAt || "")
    : (periodEndAt || "");

  const statusLabel = readString(subscriptionRow?.status, "active") === "active"
    ? (input.lang === "fr" ? "Actif" : "Active")
    : pendingLabel(input.lang);

  return {
    accountId,
    username: readString(account.username, "Instagram account").replace(/^@+/, ""),
    planLabel,
    statusLabel,
    priceLabel,
    growthLabel,
    supportLabel,
    billingDisplayMode: projection.billingDisplayMode,
    billingDateIso,
  };
}
