import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";
import { getStripeTestReadiness } from "@/lib/commercial/stripe/stripe-readiness.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;

  const readiness = await getStripeTestReadiness(createSupabaseClient());
  return jsonOk({ readiness });
}
