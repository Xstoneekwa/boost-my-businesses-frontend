import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStripeCatalogLookupKey,
  resolveStripePriceIdFromCatalogRow,
  type StripeCatalogEnvironment,
  type StripePriceCatalogRow,
} from "./stripe-catalog.ts";
import type { PlanKey } from "../catalog.ts";

type Row = Record<string, unknown>;

export async function loadStripePriceCatalogRow(
  supabase: SupabaseClient,
  input: {
    environment: StripeCatalogEnvironment;
    planKey: PlanKey;
    billingIntervalMonths: 1 | 3 | 6 | 12;
    outreachAddonKey?: string | null;
  },
): Promise<StripePriceCatalogRow | null> {
  const lookup = buildStripeCatalogLookupKey(input);
  const { data, error } = await supabase
    .from("commercial_stripe_price_catalog")
    .select("*")
    .eq("environment", input.environment)
    .eq("plan_key", lookup.plan_key)
    .eq("billing_interval_months", lookup.billing_interval_months)
    .eq("outreach_addon_key", lookup.outreach_addon_key)
    .eq("active", true)
    .maybeSingle<Row>();

  if (error || !data) {
    return null;
  }
  return data as unknown as StripePriceCatalogRow;
}

export async function resolveServerStripePriceId(
  supabase: SupabaseClient,
  input: {
    environment: StripeCatalogEnvironment;
    planKey: PlanKey;
    billingIntervalMonths: 1 | 3 | 6 | 12;
    outreachAddonKey?: string | null;
  },
) {
  const row = await loadStripePriceCatalogRow(supabase, input);
  return resolveStripePriceIdFromCatalogRow(row);
}

export async function countActiveStripePriceCatalogMappings(
  supabase: SupabaseClient,
  environment: StripeCatalogEnvironment,
) {
  const { count, error } = await supabase
    .from("commercial_stripe_price_catalog")
    .select("id", { count: "exact", head: true })
    .eq("environment", environment)
    .eq("active", true);
  if (error) {
    return 0;
  }
  return count ?? 0;
}
