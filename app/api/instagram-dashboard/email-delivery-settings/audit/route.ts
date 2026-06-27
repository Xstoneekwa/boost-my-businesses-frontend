import { createSupabaseClient } from "@/lib/supabase";
import { loadTransactionalDeliverySettingsAudit } from "@/lib/instagram-dashboard/client-email-delivery-settings";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function withNoStore<T>(response: NextResponse<T>) {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email delivery settings audit");
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const supabase = createSupabaseClient();
    const audit = await loadTransactionalDeliverySettingsAudit(supabase);
    return withNoStore(jsonOk(audit));
  } catch {
    return withNoStore(jsonError("Could not load email delivery settings audit.", 500));
  }
}
