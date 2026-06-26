import { NextResponse } from "next/server";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { loadClientEmailHistoryDetail } from "@/lib/instagram-dashboard/client-email-history";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ intentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email history detail");
  if (unauthorizedResponse) return unauthorizedResponse;

  const { intentId } = await context.params;

  try {
    const supabase = createSupabaseClient();
    const result = await loadClientEmailHistoryDetail(supabase, intentId);
    if (!result.ok) {
      if (result.reason === "feature_unavailable") {
        return NextResponse.json({
          ok: false,
          featureAvailable: false,
          reason: "feature_unavailable",
          error: "Email infrastructure is not enabled yet.",
        }, { status: 503 });
      }
      return jsonError("Email intent not found.", 404);
    }
    return jsonOk({
      featureAvailable: true,
      detail: result.detail,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load email history detail.";
    return jsonError(message, 500);
  }
}
