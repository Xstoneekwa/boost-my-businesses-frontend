import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import {
  loadClientAccountNotificationsForClient,
  markClientAccountNotificationRead,
  probeClientAccountNotificationsTable,
  reconcileClientAccountNotificationsForClient,
} from "@/lib/instagram-client/client-account-notifications";
import { readString, rejectTechnicalClientFields, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }

  try {
    const supabase = createSupabaseClient();
    await reconcileClientAccountNotificationsForClient(supabase, session.clientId);
    const projection = await loadClientAccountNotificationsForClient(supabase, session.clientId);
    return NextResponse.json({
      ok: true,
      featureAvailable: projection.featureAvailable,
      data: projection,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load client notifications.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

type PatchBody = {
  notification_id?: unknown;
  action?: unknown;
};

export async function PATCH(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }

  let body: PatchBody | null = null;
  try {
    body = await request.json() as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) {
    return NextResponse.json({ ok: false, error: technicalError }, { status: 400 });
  }

  const notificationId = readString(body?.notification_id, "").trim();
  const action = readString(body?.action, "").trim();
  if (!notificationId) {
    return NextResponse.json({ ok: false, error: "Missing notification_id." }, { status: 400 });
  }
  if (action !== "mark_read") {
    return NextResponse.json({ ok: false, error: "Unsupported notification action." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseClient();
    const table = await probeClientAccountNotificationsTable(supabase);
    if (!table.available) {
      return NextResponse.json(buildClientNotificationsUnavailablePatchResponse());
    }

    const result = await markClientAccountNotificationRead(supabase, {
      clientId: session.clientId,
      notificationId,
    });
    if (!result.ok) {
      if (result.reason === "feature_unavailable") {
        return NextResponse.json(buildClientNotificationsUnavailablePatchResponse());
      }
      return NextResponse.json({ ok: false, error: "Notification not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, featureAvailable: true, data: result.notification });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update notification.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export function buildClientNotificationsUnavailablePatchResponse() {
  return {
    ok: false as const,
    featureAvailable: false as const,
    reason: "feature_unavailable" as const,
    error: "Client account notifications are not available yet.",
  };
}
