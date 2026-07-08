import { readJsonBody, readString } from "@/app/api/instagram-dashboard/_utils";
import { getInstagramAdminUserContext, requireInstagramAdmin } from "../../_utils";
import { startAssistedAutoLoginFromReservation } from "@/lib/instagram-dashboard/start-assisted-auto-login";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Body = {
  account_id?: unknown;
  reservation_id?: unknown;
  action_id?: unknown;
};

export async function POST(request: Request) {
  try {
    const unauthorized = await requireInstagramAdmin();
    if (unauthorized) return unauthorized;

    const body = await readJsonBody<Body>(request);
    const accountId = readString(body?.account_id);
    const reservationId = readString(body?.reservation_id);
    const actionId = readString(body?.action_id) || null;

    if (!accountId || !reservationId) {
      return Response.json({ ok: false, message: "account_id and reservation_id are required." }, { status: 400 });
    }

    const adminContext = await getInstagramAdminUserContext();
    const supabase = createSupabaseClient();
    const result = await startAssistedAutoLoginFromReservation(supabase, {
      accountId,
      reservationId,
      actionId,
      actorId: adminContext?.userId ?? null,
    });

    if (!result.ok) {
      return Response.json({ ok: false, reason: result.reason, message: result.message }, { status: 409 });
    }

    return Response.json({
      ok: true,
      status: result.connect.status,
      reason: result.connect.reason,
      message: result.connect.message,
      request_queued: result.connect.request_queued,
      reservation_status: result.reservation?.status ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Start Auto Login failed.";
    return Response.json({ ok: false, message }, { status: 500 });
  }
}
