import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { loadClientEmailLifecycleOutboxPreview } from "@/lib/instagram-dashboard/client-email-lifecycle-outbox-preview";
import { jsonError, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Transactional email outbox preview");
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const supabase = createSupabaseClient();
    const preview = await loadClientEmailLifecycleOutboxPreview(supabase);
    return NextResponse.json(
      { ok: true, data: preview },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Could not load transactional email outbox preview.";
    return jsonError(message, 500);
  }
}
