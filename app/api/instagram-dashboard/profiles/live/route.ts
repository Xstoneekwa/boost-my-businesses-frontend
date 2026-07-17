import { jsonError, jsonOk, requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "@/app/api/instagram-dashboard/compass/relay-auth";
import { projectProfilesLive } from "@/lib/instagram-dashboard/profiles-live-projection";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return null;
  if (!relayAuth.ok) {
    return jsonError("Profiles relay authentication failed.", relayAuthStatus(compassRelayAuthFailureReason(relayAuth)), { reason: compassRelayAuthFailureReason(relayAuth) });
  }
  return requireInstagramAdmin();
}

function accountIdsFromRequest(request: Request) {
  const raw = new URL(request.url).searchParams.get("account_ids") ?? "";
  return [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 200);
}

export async function GET(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;
    const accountIds = accountIdsFromRequest(request);
    const now = new Date().toISOString();
    if (!accountIds.length) return jsonOk({ generated_at: now, profiles: [], query_count: 0 });

    const since = `${now.slice(0, 10)}T00:00:00.000Z`;
    const supabase = createSupabaseClient();
    const [requests, runs, logs, events, unfollows, actions, followerSnapshots] = await Promise.all([
      supabase.from("account_run_requests").select("id,account_id,status,run_id,cancel_requested_at,created_at,claimed_at").in("account_id", accountIds).in("status", ["pending", "queued", "claimed", "starting", "running", "stopping", "canceling"]).limit(1000),
      supabase.from("ig_runs").select("id,account_id,status,total_follow,total_like,total_dm,total_story,created_at,started_at,finished_at").in("account_id", accountIds).gte("created_at", since).order("created_at", { ascending: false }).limit(10000),
      supabase.from("ig_action_logs").select("id,account_id,run_id,target_username,action_type,status,payload,created_at").in("account_id", accountIds).gte("created_at", since).limit(10000),
      supabase.from("ig_interaction_events").select("id,account_id,run_id,username,event_type,event_status,event_at,created_at,payload").in("account_id", accountIds).gte("event_at", since).lte("event_at", now).limit(10000),
      supabase.from("ig_interacted_users").select("id,account_id,run_id,last_run_id,username,unfollowed_at,unfollow_result,interaction_status,evidence_confidence").in("account_id", accountIds).eq("unfollow_result", "success").gte("unfollowed_at", since).lte("unfollowed_at", now).limit(10000),
      supabase.from("account_dashboard_actions").select("id,account_id,action_type,status,blocking_campaign,created_at,dedupe_key,metadata,metadata_safe").in("account_id", accountIds).in("status", ["pending", "acknowledged", "pending_verification"]).limit(1000),
      supabase.from("ig_account_follower_snapshots").select("id,account_id,followers_count,captured_at,source,observation_kind,created_at").in("account_id", accountIds).order("captured_at", { ascending: false }).limit(10000),
    ]);
    const failed = [requests, runs, logs, events, unfollows, actions, followerSnapshots].find((result) => result.error);
    if (failed?.error) return jsonError("Could not load live Profiles projection.", 500);

    return jsonOk({
      generated_at: now,
      profiles: projectProfilesLive({
        accountIds,
        now,
        requests: requests.data ?? [],
        runs: runs.data ?? [],
        actionLogs: logs.data ?? [],
        interactionEvents: events.data ?? [],
        unfollowRows: unfollows.data ?? [],
        dashboardActions: actions.data ?? [],
        followerSnapshots: followerSnapshots.data ?? [],
      }),
      query_count: 7,
      source: "profiles_live_batched_v2",
    });
  } catch {
    return jsonError("Could not load live Profiles projection.", 500);
  }
}
