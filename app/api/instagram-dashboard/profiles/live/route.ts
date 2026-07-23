import { jsonError, jsonOk, requireInstagramAdmin } from "@/app/api/instagram-dashboard/_utils";
import { compassRelayAuthFailureReason, relayAuthStatus, verifyCompassRelayKey } from "@/app/api/instagram-dashboard/compass/relay-auth";
import { projectProfilesLive } from "@/lib/instagram-dashboard/profiles-live-projection";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const archivedStatuses = new Set(["archived", "trashed", "deleted"]);

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
  return [...new Set(raw.split(",").map((value) => value.trim()).filter((value) => uuidPattern.test(value)))].slice(0, 200);
}

function liveJsonOk(data: Record<string, unknown>) {
  const response = jsonOk(data);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  try {
    const unauthorized = await requireRelayOrAdmin(request);
    if (unauthorized) return unauthorized;

    const requestedAccountIds = accountIdsFromRequest(request);
    const now = new Date().toISOString();
    if (!requestedAccountIds.length) {
      return liveJsonOk({
        generated_at: now,
        profiles: [],
        removed_account_ids: [],
        archived_account_ids: [],
        query_count: 0,
        source: "profiles_live_batched_v2",
        projection_mode: "full_snapshot",
      });
    }

    const supabase = createSupabaseClient();
    const accounts = await supabase
      .from("ig_accounts")
      .select("id,status,admin_lifecycle_status")
      .in("id", requestedAccountIds)
      .limit(200);
    if (accounts.error) return jsonError("Could not load live Profiles projection.", 500);

    const accountRows = accounts.data ?? [];
    const existingAccountIds = accountRows
      .map((row) => typeof row.id === "string" ? row.id : "")
      .filter(Boolean);
    const existingAccountIdSet = new Set(existingAccountIds);
    const removedAccountIds = requestedAccountIds.filter((id) => !existingAccountIdSet.has(id));
    const archivedAccountIds = accountRows
      .filter((row) => archivedStatuses.has(String(row.admin_lifecycle_status ?? row.status ?? "").trim().toLowerCase()))
      .map((row) => String(row.id));

    if (!existingAccountIds.length) {
      return liveJsonOk({
        generated_at: now,
        profiles: [],
        removed_account_ids: removedAccountIds,
        archived_account_ids: archivedAccountIds,
        query_count: 1,
        source: "profiles_live_batched_v2",
        projection_mode: "full_snapshot",
      });
    }

    const since = `${now.slice(0, 10)}T00:00:00.000Z`;
    const [requests, runs, logs, events, unfollows, actions, followerSnapshots] = await Promise.all([
      supabase.from("account_run_requests").select("id,account_id,status,run_id,cancel_requested_at,created_at,claimed_at").in("account_id", existingAccountIds).in("status", ["pending", "queued", "claimed", "starting", "running", "stopping", "canceling"]).limit(1000),
      supabase.from("ig_runs").select("id,account_id,status,total_follow,total_like,total_dm,total_story,created_at,started_at,finished_at").in("account_id", existingAccountIds).gte("created_at", since).order("created_at", { ascending: false }).limit(10000),
      supabase.from("ig_action_logs").select("id,account_id,run_id,target_username,action_type,status,payload,created_at").in("account_id", existingAccountIds).gte("created_at", since).limit(10000),
      supabase.from("ig_interaction_events").select("id,account_id,run_id,username,event_type,event_status,event_at,created_at,payload").in("account_id", existingAccountIds).gte("event_at", since).lte("event_at", now).limit(10000),
      supabase.from("ig_interacted_users").select("id,account_id,run_id,last_run_id,username,unfollowed_at,unfollow_result,interaction_status,evidence_confidence").in("account_id", existingAccountIds).eq("unfollow_result", "success").gte("unfollowed_at", since).lte("unfollowed_at", now).limit(10000),
      supabase.from("account_dashboard_actions").select("id,account_id,action_type,status,blocking_campaign,created_at,dedupe_key,metadata,metadata_safe").in("account_id", existingAccountIds).in("status", ["pending", "acknowledged", "pending_verification"]).limit(1000),
      supabase.from("ig_account_follower_snapshots").select("id,account_id,followers_count,captured_at,source,observation_kind,created_at").in("account_id", existingAccountIds).order("captured_at", { ascending: false }).limit(10000),
    ]);
    const failed = [requests, runs, logs, events, unfollows, actions, followerSnapshots].find((result) => result.error);
    if (failed?.error) return jsonError("Could not load live Profiles projection.", 500);

    return liveJsonOk({
      generated_at: now,
      profiles: projectProfilesLive({
        accountIds: existingAccountIds,
        now,
        requests: requests.data ?? [],
        runs: runs.data ?? [],
        actionLogs: logs.data ?? [],
        interactionEvents: events.data ?? [],
        unfollowRows: unfollows.data ?? [],
        dashboardActions: actions.data ?? [],
        followerSnapshots: followerSnapshots.data ?? [],
      }),
      removed_account_ids: removedAccountIds,
      archived_account_ids: archivedAccountIds,
      query_count: 8,
      source: "profiles_live_batched_v2",
      projection_mode: "full_snapshot",
    });
  } catch {
    return jsonError("Could not load live Profiles projection.", 500);
  }
}
