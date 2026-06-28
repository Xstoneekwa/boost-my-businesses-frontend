import {
  COMMERCIAL_CATALOG_VERSION,
  COMMERCIAL_PLANS,
  OUTREACH_ADDONS,
  TERM_DISCOUNT_PERCENT,
  type BillingIntervalMonths,
  type DiscountType,
  type OutreachAddonKey,
  type PlanKey,
  catalogSnapshot,
  isBillingIntervalMonths,
  isOutreachAddonKey,
  isPlanKey,
} from "./catalog.ts";
import { agencyDiscountPercentForBillableCount } from "./agency.ts";
import {
  resolveCommercialAccountCounts,
  type CommercialPricingContext,
} from "./commercial-account-counts.ts";

export const COMMERCIAL_PRICING_SNAPSHOT_VERSION = "2026-06-25.1";

export type AppliedDiscountKind = "none" | "duration" | "agency_volume";

export type CommercialPricingSnapshot = {
  version: string;
  calculatedAt: string;
  pricingContext: CommercialPricingContext;
  planKey: PlanKey;
  billingIntervalMonths: BillingIntervalMonths;
  outreachAddonKey: OutreachAddonKey | null;
  currency: "EUR";
  agencyDisplayCount: number;
  billableAccountCount: number;
  agencyModeActive: boolean;
  volumeDiscountTierLabel: string | null;
  durationDiscountPercent: number;
  volumeDiscountPercent: number;
  appliedDiscountKind: AppliedDiscountKind;
  appliedDiscountPercent: number;
  discountRule: "best_single_discount_only";
  tieBreakRule: "duration_wins_on_equal_percent";
  packBaseMonthlyCents: number;
  packDiscountAmountCents: number;
  packFinalMonthlyCents: number;
  packPeriodTotalCents: number;
  outreachBaseMonthlyCents: number | null;
  outreachDiscountAmountCents: number | null;
  outreachFinalMonthlyCents: number | null;
  outreachPeriodTotalCents: number | null;
  totalPeriodCents: number;
  clientMessageFr: string;
  clientMessageEn: string;
  catalogVersion: string;
};

function roundCents(value: number) {
  return Math.round(value);
}

export function volumeDiscountTierLabelForBillableCount(billableAccountCount: number): string | null {
  const count = Math.max(1, Math.floor(billableAccountCount));
  const percent = agencyDiscountPercentForBillableCount(count);
  if (percent <= 0) return null;

  if (count >= 51) return "51+";
  if (count >= 41) return "41-50";
  if (count >= 26) return "26-40";
  if (count >= 11) return "11-25";
  if (count >= 6) return "6-10";
  return null;
}

export function resolveAppliedDiscount(input: {
  durationDiscountPercent: number;
  volumeDiscountPercent: number;
}): { kind: AppliedDiscountKind; percent: number } {
  const duration = Math.max(0, input.durationDiscountPercent);
  const volume = Math.max(0, input.volumeDiscountPercent);

  if (volume > duration) {
    return { kind: "agency_volume", percent: volume };
  }
  if (duration > 0) {
    return { kind: "duration", percent: duration };
  }
  return { kind: "none", percent: 0 };
}

export function appliedDiscountKindToDbType(kind: AppliedDiscountKind): DiscountType {
  if (kind === "duration") return "term";
  if (kind === "agency_volume") return "agency";
  return "none";
}

export function appliedDiscountDbTypeToKind(type: string): AppliedDiscountKind {
  if (type === "term") return "duration";
  if (type === "agency") return "agency_volume";
  return "none";
}

function buildClientMessages(input: {
  agencyModeActive: boolean;
  agencyDisplayCount: number;
  billableAccountCount: number;
  volumeDiscountPercent: number;
  volumeDiscountTierLabel: string | null;
  pricingContext: CommercialPricingContext;
}): { fr: string; en: string } {
  if (!input.agencyModeActive) {
    return {
      fr: "",
      en: "",
    };
  }

  if (input.volumeDiscountPercent <= 0) {
    return {
      fr: "Mode Agence actif — remise volume disponible à partir de 6 comptes.",
      en: "Agency Mode active — volume discount available from 6 accounts.",
    };
  }

  const tier = input.volumeDiscountTierLabel ?? `${input.billableAccountCount}`;
  const percentLabel = `${Math.round(input.volumeDiscountPercent * 100)} %`;
  return {
    fr: `Mode Agence actif — palier volume ${tier} (−${percentLabel} sur les nouvelles souscriptions). Les prix déjà acceptés restent inchangés.`,
    en: `Agency Mode active — volume tier ${tier} (−${percentLabel} on new subscriptions). Already accepted prices stay unchanged.`,
  };
}

export function buildCommercialPricingSnapshot(input: {
  planKey: string;
  billingIntervalMonths: number;
  outreachAddonKey?: string | null;
  linkedAccountCount: number;
  reservedEntitlementCount: number;
  pricingContext: CommercialPricingContext;
  billableAccountCountOverride?: number | null;
  calculatedAt?: string;
}): CommercialPricingSnapshot | { ok: false; error: string } {
  if (!isPlanKey(input.planKey)) {
    return { ok: false, error: "invalid_plan_key" };
  }
  if (!isBillingIntervalMonths(input.billingIntervalMonths)) {
    return { ok: false, error: "invalid_billing_interval" };
  }

  const outreachAddonKey: OutreachAddonKey | null = input.outreachAddonKey?.trim()
    ? (isOutreachAddonKey(input.outreachAddonKey.trim())
      ? input.outreachAddonKey.trim() as OutreachAddonKey
      : null)
    : null;
  if (input.outreachAddonKey?.trim() && !outreachAddonKey) {
    return { ok: false, error: "invalid_outreach_addon" };
  }

  const counts = resolveCommercialAccountCounts({
    linkedAccountCount: input.linkedAccountCount,
    reservedEntitlementCount: input.reservedEntitlementCount,
    pricingContext: input.pricingContext,
    billableAccountCountOverride: input.billableAccountCountOverride,
  });

  const plan = COMMERCIAL_PLANS[input.planKey];
  const durationDiscountPercent = TERM_DISCOUNT_PERCENT[input.billingIntervalMonths];
  const volumeDiscountPercent = agencyDiscountPercentForBillableCount(counts.billableAccountCount);
  const applied = resolveAppliedDiscount({ durationDiscountPercent, volumeDiscountPercent });

  const packBaseMonthlyCents = plan.baseMonthlyPriceCents;
  const packFinalMonthlyCents = roundCents(packBaseMonthlyCents * (1 - applied.percent));
  const packDiscountAmountCents = packBaseMonthlyCents - packFinalMonthlyCents;
  const packPeriodTotalCents = packFinalMonthlyCents * input.billingIntervalMonths;

  const outreachAddon = outreachAddonKey ? OUTREACH_ADDONS[outreachAddonKey] : null;
  const outreachBaseMonthlyCents = outreachAddon?.baseMonthlyPriceCents ?? null;
  const outreachFinalMonthlyCents = outreachBaseMonthlyCents != null
    ? roundCents(outreachBaseMonthlyCents * (1 - applied.percent))
    : null;
  const outreachDiscountAmountCents = outreachBaseMonthlyCents != null && outreachFinalMonthlyCents != null
    ? outreachBaseMonthlyCents - outreachFinalMonthlyCents
    : null;
  const outreachPeriodTotalCents = outreachFinalMonthlyCents != null
    ? outreachFinalMonthlyCents * input.billingIntervalMonths
    : null;

  const totalPeriodCents = packPeriodTotalCents + (outreachPeriodTotalCents ?? 0);
  const volumeDiscountTierLabel = volumeDiscountTierLabelForBillableCount(counts.billableAccountCount);
  const messages = buildClientMessages({
    agencyModeActive: counts.agencyModeActive,
    agencyDisplayCount: counts.agencyDisplayCount,
    billableAccountCount: counts.billableAccountCount,
    volumeDiscountPercent,
    volumeDiscountTierLabel,
    pricingContext: input.pricingContext,
  });

  return {
    version: COMMERCIAL_PRICING_SNAPSHOT_VERSION,
    calculatedAt: input.calculatedAt ?? new Date().toISOString(),
    pricingContext: input.pricingContext,
    planKey: input.planKey,
    billingIntervalMonths: input.billingIntervalMonths,
    outreachAddonKey,
    currency: "EUR",
    agencyDisplayCount: counts.agencyDisplayCount,
    billableAccountCount: counts.billableAccountCount,
    agencyModeActive: counts.agencyModeActive,
    volumeDiscountTierLabel,
    durationDiscountPercent,
    volumeDiscountPercent,
    appliedDiscountKind: applied.kind,
    appliedDiscountPercent: applied.percent,
    discountRule: "best_single_discount_only",
    tieBreakRule: "duration_wins_on_equal_percent",
    packBaseMonthlyCents,
    packDiscountAmountCents,
    packFinalMonthlyCents,
    packPeriodTotalCents,
    outreachBaseMonthlyCents,
    outreachDiscountAmountCents,
    outreachFinalMonthlyCents,
    outreachPeriodTotalCents,
    totalPeriodCents,
    clientMessageFr: messages.fr,
    clientMessageEn: messages.en,
    catalogVersion: COMMERCIAL_CATALOG_VERSION,
  };
}

export function buildDashboardAgencyPricingSnapshot(input: {
  linkedAccountCount: number;
  reservedEntitlementCount: number;
}) {
  return buildCommercialPricingSnapshot({
    planKey: "pro",
    billingIntervalMonths: 1,
    outreachAddonKey: null,
    linkedAccountCount: input.linkedAccountCount,
    reservedEntitlementCount: input.reservedEntitlementCount,
    pricingContext: "dashboard_readonly",
  });
}

export function pricingSnapshotAuditPayload(snapshot: CommercialPricingSnapshot) {
  return {
    pricing_snapshot_version: snapshot.version,
    pricing_context: snapshot.pricingContext,
    agency_display_count: snapshot.agencyDisplayCount,
    billable_account_count: snapshot.billableAccountCount,
    agency_mode_active: snapshot.agencyModeActive,
    duration_discount_percent: snapshot.durationDiscountPercent,
    volume_discount_percent: snapshot.volumeDiscountPercent,
    applied_discount_kind: snapshot.appliedDiscountKind,
    applied_discount_percent: snapshot.appliedDiscountPercent,
    volume_discount_tier_label: snapshot.volumeDiscountTierLabel,
    total_period_cents: snapshot.totalPeriodCents,
  };
}

/** Legacy rows without pricing_snapshot remain untouched (null). */
export function isLegacyCommercialPricingRecord(pricingSnapshot: unknown) {
  return pricingSnapshot == null
    || (typeof pricingSnapshot === "object" && pricingSnapshot !== null && Object.keys(pricingSnapshot as object).length === 0);
}

export function snapshotCatalogEnvelope() {
  return catalogSnapshot();
}
