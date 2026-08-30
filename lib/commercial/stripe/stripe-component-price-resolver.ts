import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingIntervalMonths, OutreachAddonKey, PlanKey } from "../catalog.ts";
import type { StripeCatalogEnvironment } from "./stripe-catalog.ts";
import { isValidStripePriceId } from "./stripe-catalog.ts";
import type {
  ProductKey,
  StripeBillingComponent,
  StripeComponentKind,
} from "./stripe-per-entitlement-billing.ts";
import {
  productKeyForPackage,
  publicCatalogAmountCents,
} from "./stripe-per-entitlement-billing.ts";

type Row = Record<string, unknown>;

export type StripeComponentPriceCatalogRow = {
  id: string;
  environment: StripeCatalogEnvironment;
  product_key: ProductKey;
  component_kind: StripeComponentKind;
  package_key: PlanKey | null;
  outreach_key: OutreachAddonKey | null;
  billing_interval_months: BillingIntervalMonths;
  stripe_product_id: string;
  stripe_price_id: string;
  expected_amount_cents: number;
  currency: "eur";
  active: boolean;
  catalog_version: string | null;
};

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function normalizeComponentRow(row: Row): StripeComponentPriceCatalogRow {
  return {
    id: readString(row.id),
    environment: readString(row.environment) as StripeCatalogEnvironment,
    product_key: readString(row.product_key) as ProductKey,
    component_kind: readString(row.component_kind) as StripeComponentKind,
    package_key: readString(row.package_key) as PlanKey || null,
    outreach_key: readString(row.outreach_key) as OutreachAddonKey || null,
    billing_interval_months: Number(row.billing_interval_months) as BillingIntervalMonths,
    stripe_product_id: readString(row.stripe_product_id),
    stripe_price_id: readString(row.stripe_price_id),
    expected_amount_cents: Number(row.expected_amount_cents),
    currency: readString(row.currency, "eur") as "eur",
    active: row.active === true,
    catalog_version: readString(row.catalog_version) || null,
  };
}

export async function loadStripeComponentPriceCatalogRow(
  supabase: SupabaseClient,
  input: {
    environment: StripeCatalogEnvironment;
    component: StripeBillingComponent;
  },
) {
  const { data, error } = await supabase
    .from("commercial_stripe_component_price_catalog")
    .select("*")
    .eq("environment", input.environment)
    .eq("product_key", input.component.productKey)
    .eq("component_kind", input.component.componentKind)
    .eq("billing_interval_months", input.component.billingIntervalMonths)
    .eq("expected_amount_cents", input.component.amountCents)
    .eq("currency", input.component.currency)
    .eq("active", true)
    .maybeSingle<Row>();
  if (error || !data) return null;
  const row = normalizeComponentRow(data);
  if (row.component_kind === "package" && row.package_key !== input.component.packageKey) return null;
  if (row.component_kind === "outreach" && row.outreach_key !== input.component.outreachKey) return null;
  return row;
}

export async function resolveStripeComponentPriceId(
  supabase: SupabaseClient,
  input: {
    environment: StripeCatalogEnvironment;
    component: StripeBillingComponent;
  },
) {
  const row = await loadStripeComponentPriceCatalogRow(supabase, input);
  return row?.active ? row.stripe_price_id : null;
}

/**
 * Canonical public-catalog package resolver shared by quote, confirmation,
 * Stripe mutation and webhook reconciliation. The component identity includes
 * the catalog-derived amount, so stale or cross-package mappings fail closed.
 */
export async function resolveCanonicalPackageStripePriceCatalogRow(
  supabase: SupabaseClient,
  input: {
    environment: StripeCatalogEnvironment;
    planKey: PlanKey;
    billingIntervalMonths: BillingIntervalMonths;
  },
) {
  const component: StripeBillingComponent = {
    componentKind: "package",
    productKey: productKeyForPackage(input.planKey),
    packageKey: input.planKey,
    outreachKey: null,
    billingIntervalMonths: input.billingIntervalMonths,
    amountCents: publicCatalogAmountCents("package", input.planKey, input.billingIntervalMonths),
    currency: "eur",
  };
  return loadStripeComponentPriceCatalogRow(supabase, {
    environment: input.environment,
    component,
  });
}

export async function resolveCanonicalPackageStripePriceId(
  supabase: SupabaseClient,
  input: {
    environment: StripeCatalogEnvironment;
    planKey: PlanKey;
    billingIntervalMonths: BillingIntervalMonths;
  },
) {
  const row = await resolveCanonicalPackageStripePriceCatalogRow(supabase, input);
  return row?.active && isValidStripePriceId(row.stripe_price_id) ? row.stripe_price_id : null;
}

export async function resolveStripeProductIdForComponent(
  supabase: SupabaseClient,
  input: {
    environment: StripeCatalogEnvironment;
    component: StripeBillingComponent;
  },
) {
  const { data, error } = await supabase
    .from("commercial_stripe_component_price_catalog")
    .select("stripe_product_id")
    .eq("environment", input.environment)
    .eq("product_key", input.component.productKey)
    .eq("component_kind", input.component.componentKind)
    .eq("active", true)
    .limit(1)
    .maybeSingle<Row>();
  if (error || !data) return null;
  return readString(data.stripe_product_id) || null;
}

export async function countActiveStripeComponentPriceCatalogMappings(
  supabase: SupabaseClient,
  environment: StripeCatalogEnvironment,
) {
  const { count, error } = await supabase
    .from("commercial_stripe_component_price_catalog")
    .select("id", { count: "exact", head: true })
    .eq("environment", environment)
    .eq("active", true);
  if (error) {
    return 0;
  }
  return count ?? 0;
}
