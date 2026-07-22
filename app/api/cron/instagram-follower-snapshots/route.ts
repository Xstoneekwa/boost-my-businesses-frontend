import { NextResponse } from "next/server";
import {
  classifyAutomaticSocialProfileSnapshotJobs,
  enqueueDailySocialProfileSnapshotJobs,
  processSocialProfileSnapshotJobs,
} from "@/lib/instagram-dashboard/social-profile-snapshot-service";
import { socialProfileSnapshotsEnabled } from "@/lib/instagram-dashboard/social-profile-snapshot-rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  if (dryRun) {
    try {
      const classification = await classifyAutomaticSocialProfileSnapshotJobs({});
      return NextResponse.json({
        ok: true,
        data: {
          dryRun: true,
          writes: 0,
          providerCalls: 0,
          ...classification,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "follower_snapshot_dry_run_failed";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (!socialProfileSnapshotsEnabled(process.env.SOCIAL_PROFILE_SNAPSHOTS_ENABLED)) {
    return NextResponse.json({
      ok: true,
      data: {
        status: "skipped_disabled",
        providerCalls: 0,
        jobsCreated: 0,
        jobsProcessed: 0,
      },
    });
  }

  try {
    const enqueue = await enqueueDailySocialProfileSnapshotJobs({});
    const processing = await processSocialProfileSnapshotJobs({});
    const result = { enqueue, processing };
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "follower_snapshot_cron_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
