import { readString } from "@/app/api/instagram-dashboard/_utils";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { loadAssignedDeviceForAccount } from "@/lib/instagram-client/load-assigned-device-for-account";
import { createOpenDeviceViewIntent } from "@/lib/instagram-client/open-botapp-phone-intent";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
    }

    const { accountId } = await context.params;
    const normalizedAccountId = readString(accountId);
    if (!normalizedAccountId) {
      return NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 });
    }

    const authorized = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
    if (!authorized.ok) {
      return NextResponse.json({ ok: false, error: authorized.error }, { status: authorized.status });
    }

    const assigned = await loadAssignedDeviceForAccount(normalizedAccountId);
    if (!assigned) {
      return NextResponse.json({
        ok: false,
        error: "La vérification nécessite l'assistance de l'équipe de gestion.",
        code: "botapp_phone_unavailable",
        data: { botapp_available: false },
      }, { status: 409 });
    }

    const intent = createOpenDeviceViewIntent({
      accountId: normalizedAccountId,
      actorUserId: session.userId,
    });
    if (!intent) {
      return NextResponse.json({
        ok: false,
        error: "La vérification nécessite l'assistance de l'équipe de gestion.",
        code: "botapp_intent_unavailable",
        data: { botapp_available: false },
      }, { status: 503 });
    }

    return NextResponse.json({
      ok: true,
      data: {
        action: "open_device_view",
        account_id: normalizedAccountId,
        intent_token: intent.intent_token,
        open_url: intent.open_url,
        expires_at: intent.expires_at,
        botapp_available: true,
        message: "Ouvrez le téléphone dans BotApp pour terminer la vérification.",
      },
    });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "La vérification nécessite l'assistance de l'équipe de gestion.",
      code: "botapp_handoff_failed",
      data: { botapp_available: false },
    }, { status: 503 });
  }
}
