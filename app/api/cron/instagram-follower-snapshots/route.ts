import { NextResponse } from "next/server";
import { runDailyFollowerSnapshotCollection } from "@/lib/instagram-dashboard/follower-snapshot-daily";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const result = await runDailyFollowerSnapshotCollection({ dryRun });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "follower_snapshot_cron_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
