import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMERCIAL_PLANS, type PlanKey } from "../commercial/catalog.ts";

type Row = Record<string, unknown>;

export type ClientBillingDisplayMode = "period_end" | "next_billing";

export type ClientSubscriptionProjection = {
  clientPlanLabel: string;
  memberSince: string | null;
  subscriptionPeriodEnd: string | null;
  billingDisplayMode: ClientBillingDisplayMode;
  paymentMethodDisplay: string;
  subscriptionStatus: string;
  subscriptionGrowthLabel: string;
  subscriptionPriceLabel: string;
  subscriptionSupportLabel: string;
};

export type ClientCommercialSubscriptionRow = {
  planKey: string | null;
  billingIntervalMonths: number | null;
  periodStartAt: string | null;
  periodEndAt: string | null;
  growthEstimateLabel: string | null;
  monthlyPriceCents: number | null;
};

const RUNTIME_PACKAGE_CODES = new Set([
  "full_cycle",
  "outreach_only",
  "outreach_cycle",
  "account_session",
  "outreach_session",
  "safe_setup",
  "follow_only_test",
]);

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readMetadataString(metadata: unknown, key: string, fallback = "") {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return fallback;
  return readString((metadata as Row)[key], fallback);
}

function isKnownCommercialPlanKey(value: string): value is PlanKey {
  return value in COMMERCIAL_PLANS;
}

export function resolveClientPlanLabel(planKey: string | null | undefined, lang: "fr" | "en") {
  const normalized = readString(planKey).toLowerCase();
  if (!normalized || RUNTIME_PACKAGE_CODES.has(normalized)) {
    return lang === "fr" ? "Formule en cours d'activation" : "Plan activation in progress";
  }
  if (isKnownCommercialPlanKey(normalized)) {
    return COMMERCIAL_PLANS[normalized].displayName;
  }
  return lang === "fr" ? "Formule en cours d'activation" : "Plan activation in progress";
}

export function addCalendarMonthsUtc(iso: string, months: number) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || months <= 0) return null;
  const utcYear = date.getUTCFullYear();
  const utcMonth = date.getUTCMonth();
  const utcDay = date.getUTCDate();
  const target = new Date(Date.UTC(utcYear, utcMonth + months, utcDay, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  return target.toISOString();
}

export function resolveSubscriptionPeriodEnd(input: {
  periodStartAt: string | null;
  billingIntervalMonths: number | null;
  explicitPeriodEndAt?: string | null;
}) {
  if (input.explicitPeriodEndAt) {
    const explicit = new Date(input.explicitPeriodEndAt);
    if (!Number.isNaN(explicit.getTime())) return explicit.toISOString();
  }
  if (!input.periodStartAt || !input.billingIntervalMonths) return null;
  return addCalendarMonthsUtc(input.periodStartAt, input.billingIntervalMonths);
}

export function formatClientMonthlyPrice(planKey: string | null, monthlyPriceCents: number | null, lang: "fr" | "en") {
  const cents = monthlyPriceCents ?? (planKey && isKnownCommercialPlanKey(planKey)
    ? COMMERCIAL_PLANS[planKey].baseMonthlyPriceCents
    : null);
  if (cents == null || cents <= 0) return "";
  const amount = Math.round(cents / 100);
  return lang === "fr" ? `${amount}€` : `€${amount}`;
}

export function defaultPaymentMethodDisplay(lang: "fr" | "en") {
  return lang === "fr"
    ? "Aucun moyen de paiement lié pour le moment"
    : "No payment method linked at the moment";
}

export function projectClientSubscriptionDisplay(input: {
  commercial: ClientCommercialSubscriptionRow | null;
  subscriptionStartsAt: string | null;
  clientCreatedAt: string | null;
  clientMetadata: Row | null;
  preferredLanguage: "fr" | "en";
}): ClientSubscriptionProjection {
  const lang = input.preferredLanguage;
  const billingPaymentMethod = readMetadataString(input.clientMetadata, "payment_method_label");
  const billingProvider = readMetadataString(input.clientMetadata, "billing_provider");
  const nextBillingAt = readMetadataString(input.clientMetadata, "next_billing_at");
  const hasRealPaymentMethod = Boolean(billingPaymentMethod || billingProvider);

  const planKey = input.commercial?.planKey ?? null;
  const periodEndAt = resolveSubscriptionPeriodEnd({
    periodStartAt: input.commercial?.periodStartAt ?? null,
    billingIntervalMonths: input.commercial?.billingIntervalMonths ?? null,
    explicitPeriodEndAt: input.commercial?.periodEndAt ?? null,
  });

  const billingDisplayMode: ClientBillingDisplayMode = hasRealPaymentMethod && nextBillingAt
    ? "next_billing"
    : "period_end";

  const paymentMethodDisplay = billingPaymentMethod
    || (hasRealPaymentMethod ? (lang === "fr" ? "À configurer" : "To be configured") : defaultPaymentMethodDisplay(lang));

  const memberSince = readString(input.subscriptionStartsAt)
    || readString(input.clientCreatedAt)
    || input.commercial?.periodStartAt
    || null;

  return {
    clientPlanLabel: resolveClientPlanLabel(planKey, lang),
    memberSince,
    subscriptionPeriodEnd: billingDisplayMode === "period_end"
      ? periodEndAt
      : (nextBillingAt || periodEndAt),
    billingDisplayMode,
    paymentMethodDisplay,
    subscriptionStatus: "active",
    subscriptionGrowthLabel: readString(input.commercial?.growthEstimateLabel),
    subscriptionPriceLabel: formatClientMonthlyPrice(planKey, input.commercial?.monthlyPriceCents ?? null, lang),
    subscriptionSupportLabel: readMetadataString(input.clientMetadata, "support_label"),
  };
}

export async function loadClientCommercialSubscriptionRow(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientCommercialSubscriptionRow | null> {
  const [{ data: entitlementRows, error: entitlementError }, { data: sessionRows, error: sessionError }] = await Promise.all([
    supabase
      .from("client_account_entitlements")
      .select("plan_key,commercial_package_code,billing_interval_months,status,created_at,metadata,pack_monthly_discounted_cents")
      .eq("client_id", clientId)
      .in("status", ["entitlement_reserved", "entitlement_consumed"])
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("commercial_checkout_sessions")
      .select("plan_key,billing_interval_months,activated_at,created_at,status")
      .eq("client_id", clientId)
      .eq("status", "checkout_activated_test")
      .in("flow_type", ["first_purchase", "plan_change"])
      .order("activated_at", { ascending: false })
      .limit(1),
  ]);

  if (entitlementError || sessionError) return null;

  const entitlement = Array.isArray(entitlementRows) ? entitlementRows[0] as Row | undefined : undefined;
  const session = Array.isArray(sessionRows) ? sessionRows[0] as Row | undefined : undefined;
  if (!entitlement && !session) return null;

  const planKey = readString(entitlement?.plan_key || session?.plan_key).toLowerCase() || null;
  const commercialPackageCode = readString(entitlement?.commercial_package_code).toLowerCase();
  const resolvedPlanKey = planKey || (isKnownCommercialPlanKey(commercialPackageCode) ? commercialPackageCode : null);

  const billingIntervalMonths = readNumber(
    entitlement?.billing_interval_months ?? session?.billing_interval_months,
    0,
  ) || null;

  const periodStartAt = readString(session?.activated_at)
    || readString(session?.created_at)
    || readString(entitlement?.created_at)
    || null;

  const entitlementMetadata = entitlement?.metadata && typeof entitlement.metadata === "object"
    ? entitlement.metadata as Row
    : null;

  return {
    planKey: resolvedPlanKey,
    billingIntervalMonths,
    periodStartAt,
    periodEndAt: null,
    growthEstimateLabel: readMetadataString(entitlementMetadata, "growth_estimate_label") || null,
    monthlyPriceCents: readNumber(entitlement?.pack_monthly_discounted_cents, 0) || null,
  };
}

export function isClientVisibleRuntimePackageCode(value: string) {
  return RUNTIME_PACKAGE_CODES.has(readString(value).toLowerCase());
}
