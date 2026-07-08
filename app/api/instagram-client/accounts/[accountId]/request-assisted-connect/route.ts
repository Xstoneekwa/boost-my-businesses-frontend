import { readJsonBody, readString } from "@/app/api/instagram-dashboard/_utils";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { clientProvisioningSlotReservationsEnabled } from "@/lib/instagram-dashboard/client-provisioning-slot-feature";
import { requestClientAssistedLogin } from "@/lib/instagram-dashboard/client-assisted-login-request";
import { loadActiveProvisioningReservationForAccount } from "@/lib/instagram-dashboard/client-provisioning-slot-reservations";
import { createSupabaseClient } from "@/lib/supabase";
import { clientProvisioningSlotMessage } from "@/lib/instagram-client/client-provisioning-slot-messages";

export const dynamic = "force-dynamic";

type Body = {
  reservation_id?: unknown;
  lang?: unknown;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    if (!clientProvisioningSlotReservationsEnabled()) {
      return Response.json({ ok: false, code: "feature_disabled", message: "Feature disabled." }, { status: 404 });
    }

    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return Response.json({ ok: false, message: session.error }, { status: session.status });
    }

    const { accountId } = await context.params;
    const normalizedAccountId = readString(accountId);
    if (!normalizedAccountId) {
      return Response.json({ ok: false, message: "Missing account id." }, { status: 400 });
    }

    const authorized = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
    if (!authorized.ok) {
      return Response.json({ ok: false, message: authorized.error }, { status: authorized.status });
    }

    const body = await readJsonBody<Body>(request);
    const lang = readString(body?.lang).toLowerCase() === "en" ? "en" : "fr";
    const supabase = createSupabaseClient();

    let reservationId = readString(body?.reservation_id);
    if (!reservationId) {
      const active = await loadActiveProvisioningReservationForAccount(supabase, normalizedAccountId);
      reservationId = active?.id || "";
    }
    if (!reservationId) {
      return Response.json({
        ok: false,
        code: "reservation_required",
        message: clientProvisioningSlotMessage("noSlotAvailable", lang),
      }, { status: 409 });
    }

    const result = await requestClientAssistedLogin(supabase, {
      igAccountId: normalizedAccountId,
      clientId: session.clientId,
      reservationId,
      actorUserId: session.userId,
    });

    if (!result.ok) {
      return Response.json({ ok: false, code: result.reason, message: "Assisted connect request failed." }, { status: 409 });
    }

    return Response.json({
      ok: true,
      action_id: result.actionId,
      idempotent: result.idempotent,
      deep_link: result.deepLink,
      message: clientProvisioningSlotMessage("assistedAlreadyRequested", lang),
    });
  } catch {
    return Response.json({ ok: false, message: "Assisted connect request failed." }, { status: 500 });
  }
}
