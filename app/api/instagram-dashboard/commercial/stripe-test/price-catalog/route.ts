import { readJsonBody, jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";
import { isValidStripePriceId, isValidStripeProductId } from "@/lib/commercial/stripe/stripe-catalog.ts";
import { isPlanKey } from "@/lib/commercial/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export async function GET() {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;

  const { data, error } = await createSupabaseClient()
    .from("commercial_stripe_price_catalog")
    .select("id,environment,plan_key,billing_interval_months,outreach_addon_key,stripe_product_id,stripe_price_id,active,updated_at")
    .eq("environment", "test")
    .order("plan_key", { ascending: true });

  if (error) {
    return jsonError("Could not load Stripe test price catalog.", 500);
  }
  return jsonOk({ mappings: data ?? [] });
}

export async function POST(request: Request) {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;

  const body = await readJsonBody<Record<string, unknown>>(request);
  if (!body) {
    return jsonError("Invalid price catalog payload.", 400, { code: "invalid_payload" });
  }
  const planKey = readString(body.plan_key);
  const billingIntervalMonths = Number(body.billing_interval_months ?? 1);
  const outreachAddonKey = readString(body.outreach_addon_key, "none");
  const stripeProductId = readString(body.stripe_product_id);
  const stripePriceId = readString(body.stripe_price_id);

  if (!isPlanKey(planKey)) {
    return jsonError("Invalid plan key.", 400, { code: "invalid_plan" });
  }
  if (![1, 3, 6, 12].includes(billingIntervalMonths)) {
    return jsonError("Invalid billing interval.", 400, { code: "invalid_interval" });
  }
  if (!["none", "outreach_standard", "outreach_ai"].includes(outreachAddonKey)) {
    return jsonError("Invalid outreach option.", 400, { code: "invalid_outreach" });
  }
  if (!isValidStripeProductId(stripeProductId) || !isValidStripePriceId(stripePriceId)) {
    return jsonError("Invalid Stripe product or price ID format.", 400, { code: "invalid_stripe_id" });
  }

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("commercial_stripe_price_catalog")
    .upsert({
      environment: "test",
      plan_key: planKey,
      billing_interval_months: billingIntervalMonths,
      outreach_addon_key: outreachAddonKey,
      stripe_product_id: stripeProductId,
      stripe_price_id: stripePriceId,
      active: body.active !== false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "environment,plan_key,billing_interval_months,outreach_addon_key" })
    .select("id,plan_key,billing_interval_months,outreach_addon_key,stripe_price_id,active")
    .single();

  if (error || !data) {
    return jsonError("Could not save Stripe test price mapping.", 500);
  }
  return jsonOk({ mapping: data });
}
