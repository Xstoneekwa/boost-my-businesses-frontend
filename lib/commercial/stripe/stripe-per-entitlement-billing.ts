import {
  COMMERCIAL_PLANS,
  OUTREACH_ADDONS,
  type BillingIntervalMonths,
  type OutreachAddonKey,
  type PlanKey,
  isBillingIntervalMonths,
  isOutreachAddonKey,
  isPlanKey,
} from "../catalog.ts";
import type { CommercialPricingSnapshot } from "../pricing-snapshot.ts";
import { buildSafeStripeMetadata, rejectUnsafeStripeMetadataKeys } from "./stripe-catalog.ts";

export type CommercialMode = "full_cycle" | "outreach_only";
export type StripeComponentKind = "package" | "outreach";
export type StripePricingMode = "public_catalog" | "immutable_snapshot";

export type StripeBillingComponent = {
  componentKind: StripeComponentKind;
  productKey: ProductKey;
  packageKey: PlanKey | null;
  outreachKey: OutreachAddonKey | null;
  billingIntervalMonths: BillingIntervalMonths;
  amountCents: number;
  currency: "eur";
};

export type ProductKey =
  | "boost_ai_growth"
  | "boost_ai_pro"
  | "boost_ai_premium"
  | "instagram_outreach_standard"
  | "instagram_outreach_ai";

export type EntitlementBillingBinding = {
  clientId: string;
  entitlementId: string;
  accountId: string | null;
  commercialMode: CommercialMode;
  pricingSnapshotFingerprint: string;
  pricingMode: StripePricingMode;
  components: StripeBillingComponent[];
};

export type BindingValidationResult =
  | { ok: true; packageComponent: StripeBillingComponent | null; outreachComponent: StripeBillingComponent | null }
  | { ok: false; code: string };

export function productKeyForPackage(planKey: PlanKey): ProductKey {
  if (planKey === "growth") return "boost_ai_growth";
  if (planKey === "pro") return "boost_ai_pro";
  return "boost_ai_premium";
}

export function productKeyForOutreach(outreachKey: OutreachAddonKey): ProductKey {
  return outreachKey === "outreach_standard"
    ? "instagram_outreach_standard"
    : "instagram_outreach_ai";
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readPositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function inferCommercialMode(input: {
  planKey?: string | null;
  outreachAddonKey?: string | null;
  explicitMode?: string | null;
}): CommercialMode | null {
  if (input.explicitMode === "full_cycle" || input.explicitMode === "outreach_only") {
    return input.explicitMode;
  }
  const hasPlan = isPlanKey(readString(input.planKey));
  const hasOutreach = isOutreachAddonKey(readString(input.outreachAddonKey));
  if (hasPlan) return "full_cycle";
  if (hasOutreach) return "outreach_only";
  return null;
}

export function componentsFromPricingSnapshot(
  snapshot: CommercialPricingSnapshot,
  commercialMode: CommercialMode,
): StripeBillingComponent[] | { ok: false; code: string } {
  if (!isBillingIntervalMonths(snapshot.billingIntervalMonths)) {
    return { ok: false, code: "invalid_billing_interval" };
  }
  const components: StripeBillingComponent[] = [];

  if (commercialMode === "full_cycle") {
    if (!isPlanKey(snapshot.planKey)) return { ok: false, code: "full_cycle_package_required" };
    const packageAmount = readPositiveInteger(snapshot.packPeriodTotalCents);
    if (!packageAmount) return { ok: false, code: "package_amount_invalid" };
    components.push({
      componentKind: "package",
      productKey: productKeyForPackage(snapshot.planKey),
      packageKey: snapshot.planKey,
      outreachKey: null,
      billingIntervalMonths: snapshot.billingIntervalMonths,
      amountCents: packageAmount,
      currency: "eur",
    });
  }

  if (commercialMode === "outreach_only" && snapshot.planKey && isPlanKey(snapshot.planKey)) {
    return { ok: false, code: "outreach_only_package_forbidden" };
  }

  const outreachKey = snapshot.outreachAddonKey;
  if (outreachKey) {
    if (!isOutreachAddonKey(outreachKey)) return { ok: false, code: "invalid_outreach" };
    const outreachAmount = readPositiveInteger(snapshot.outreachPeriodTotalCents);
    if (!outreachAmount) return { ok: false, code: "outreach_amount_invalid" };
    components.push({
      componentKind: "outreach",
      productKey: productKeyForOutreach(outreachKey),
      packageKey: null,
      outreachKey,
      billingIntervalMonths: snapshot.billingIntervalMonths,
      amountCents: outreachAmount,
      currency: "eur",
    });
  } else if (commercialMode === "outreach_only") {
    return { ok: false, code: "outreach_only_outreach_required" };
  }

  return components;
}

export function validateEntitlementBillingBinding(
  binding: EntitlementBillingBinding,
  options: { requireAccountIdForPlanChange?: boolean } = {},
): BindingValidationResult {
  if (!binding.clientId || !binding.entitlementId) return { ok: false, code: "binding_identity_missing" };
  if (options.requireAccountIdForPlanChange && !binding.accountId) {
    return { ok: false, code: "plan_change_account_required" };
  }
  if (binding.commercialMode !== "full_cycle" && binding.commercialMode !== "outreach_only") {
    return { ok: false, code: "commercial_mode_invalid" };
  }
  const packageComponents = binding.components.filter((component) => component.componentKind === "package");
  const outreachComponents = binding.components.filter((component) => component.componentKind === "outreach");
  if (packageComponents.length > 1) return { ok: false, code: "multiple_packages" };
  if (outreachComponents.length > 1) return { ok: false, code: "multiple_outreach" };

  const packageComponent = packageComponents[0] ?? null;
  const outreachComponent = outreachComponents[0] ?? null;

  if (binding.commercialMode === "full_cycle" && !packageComponent) {
    return { ok: false, code: "full_cycle_package_required" };
  }
  if (binding.commercialMode === "outreach_only" && packageComponent) {
    return { ok: false, code: "outreach_only_package_forbidden" };
  }
  if (binding.commercialMode === "outreach_only" && !outreachComponent) {
    return { ok: false, code: "outreach_only_outreach_required" };
  }

  for (const component of binding.components) {
    if (!isBillingIntervalMonths(component.billingIntervalMonths)) {
      return { ok: false, code: "invalid_billing_interval" };
    }
    if (component.currency !== "eur") return { ok: false, code: "invalid_currency" };
    if (!Number.isInteger(component.amountCents) || component.amountCents <= 0) {
      return { ok: false, code: "invalid_component_amount" };
    }
    if (component.componentKind === "package") {
      if (!component.packageKey || !isPlanKey(component.packageKey) || component.outreachKey) {
        return { ok: false, code: "invalid_package_component" };
      }
    }
    if (component.componentKind === "outreach") {
      if (!component.outreachKey || !isOutreachAddonKey(component.outreachKey) || component.packageKey) {
        return { ok: false, code: "invalid_outreach_component" };
      }
    }
  }

  if (packageComponent && outreachComponent && packageComponent.billingIntervalMonths !== outreachComponent.billingIntervalMonths) {
    return { ok: false, code: "component_interval_mismatch" };
  }

  return { ok: true, packageComponent, outreachComponent };
}

export function buildEntitlementStripeMetadata(input: {
  clientId: string;
  entitlementId: string;
  pricingSnapshotFingerprint: string;
  componentKind: StripeComponentKind;
  commercialMode: CommercialMode;
}) {
  const metadata = buildSafeStripeMetadata({
    client_id: input.clientId,
    entitlement_id: input.entitlementId,
    pricing_snapshot_fingerprint: input.pricingSnapshotFingerprint,
    component_kind: input.componentKind,
    commercial_mode: input.commercialMode,
  });
  rejectUnsafeStripeMetadataKeys(metadata);
  return metadata;
}

export function isPublicCatalogComponent(component: StripeBillingComponent) {
  if (component.componentKind === "package") {
    return Boolean(
      component.packageKey
        && component.amountCents === publicCatalogAmountCents(component.componentKind, component.packageKey, component.billingIntervalMonths),
    );
  }
  return Boolean(
    component.outreachKey
      && component.amountCents === publicCatalogAmountCents(component.componentKind, component.outreachKey, component.billingIntervalMonths),
  );
}

export function publicCatalogAmountCents(
  componentKind: StripeComponentKind,
  key: PlanKey | OutreachAddonKey,
  billingIntervalMonths: BillingIntervalMonths,
) {
  const discount = { 1: 0, 3: 0.1, 6: 0.2, 12: 0.25 }[billingIntervalMonths];
  const baseMonthly = componentKind === "package"
    ? COMMERCIAL_PLANS[key as PlanKey].baseMonthlyPriceCents
    : OUTREACH_ADDONS[key as OutreachAddonKey].baseMonthlyPriceCents;
  return Math.round(baseMonthly * (1 - discount)) * billingIntervalMonths;
}
