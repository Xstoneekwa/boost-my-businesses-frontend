import { createSupabaseClient } from "@/lib/supabase";
import { executePostmarkSenderIdentityRefresh } from "@/lib/instagram-dashboard/client-email-delivery-settings";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function withNoStore<T>(response: NextResponse<T>) {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export async function POST(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email delivery settings refresh");
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const supabase = createSupabaseClient();
    const result = await executePostmarkSenderIdentityRefresh(supabase);
    if (!result.ok) {
      const status = result.reason === "account_token_missing"
        ? 503
        : result.reason === "invalid_credentials"
          ? 502
          : 502;
      return withNoStore(jsonError(result.message, status, {
        reason: result.reason,
        projection: result.projection,
      }));
    }

    return withNoStore(jsonOk({
      refreshedAt: result.sync.refreshedAt,
      confirmedSenderCount: result.sync.confirmedIdentities.length,
      projection: result.projection,
      log_event: "transactional_delivery_sender_identities_refreshed",
    }));
  } catch {
    return withNoStore(jsonError("Could not refresh sender identities.", 500));
  }
}
