import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { loadClientEmailLifecycleReadiness } from "@/lib/instagram-dashboard/client-email-lifecycle-readiness";
import { jsonError, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email lifecycle readiness");
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const supabase = createSupabaseClient();
    const readiness = await loadClientEmailLifecycleReadiness(supabase);
    return NextResponse.json(
      { ok: true, data: readiness },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load email lifecycle readiness.";
    return jsonError(message, 500);
  }
}
