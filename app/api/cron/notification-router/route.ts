import { NextResponse } from "next/server";
import { dispatchNotificationBatch } from "@/lib/notification-router-v2/dispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const deliveries = await dispatchNotificationBatch(20);
    return NextResponse.json({
      ok: true,
      claimed: deliveries.length,
      statuses: deliveries.reduce<Record<string, number>>((summary, delivery) => {
        const status = String(delivery?.status || "unknown");
        summary[status] = (summary[status] || 0) + 1;
        return summary;
      }, {}),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "notification_dispatch_unavailable" }, { status: 503 });
  }
}
