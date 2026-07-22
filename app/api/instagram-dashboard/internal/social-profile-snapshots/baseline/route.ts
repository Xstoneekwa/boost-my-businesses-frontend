import { NextResponse } from "next/server";
import { readJsonBody, requireInstagramAdmin } from "../../../_utils";
import {
  createSocialProfileBaselineDependencies,
  runSocialProfileBaseline,
  validateSocialProfileBaselineRequest,
} from "@/lib/instagram-dashboard/social-profile-baseline";
import { socialProfileSnapshotBaselineEnabled } from "@/lib/instagram-dashboard/social-profile-snapshot-rollout";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function baselineResponse(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return unauthorizedResponse;

  if (!socialProfileSnapshotBaselineEnabled(process.env.SOCIAL_PROFILE_SNAPSHOTS_BASELINE_ENABLED)) {
    return baselineResponse({
      ok: false,
      status: "baseline_disabled",
      providerCalls: 0,
      jobsCreated: 0,
      jobsProcessed: 0,
    }, 403);
  }

  const parsed = validateSocialProfileBaselineRequest(await readJsonBody<unknown>(request));
  if (!parsed.ok) {
    return baselineResponse({
      ok: false,
      status: parsed.status,
      error: parsed.error,
      providerCalls: 0,
      jobsCreated: 0,
      jobsProcessed: 0,
    }, 400);
  }

  try {
    const result = await runSocialProfileBaseline(parsed.request, createSocialProfileBaselineDependencies());
    const status = result.ok ? 200 : 409;
    return baselineResponse(result, status);
  } catch {
    console.error(JSON.stringify({
      component: "social_profile_snapshot_baseline",
      event: "request_failed",
      error_code: "baseline_internal_error",
    }));
    return baselineResponse({
      ok: false,
      status: "baseline_failed",
      providerCalls: 0,
      jobsCreated: 0,
      jobsProcessed: 0,
    }, 500);
  }
}
