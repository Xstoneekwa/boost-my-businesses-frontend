import { createSupabaseClient } from "@/lib/supabase";
import { connectNowFromReadiness } from "@/lib/instagram-dashboard/connect-now";
import { runReadinessNow } from "@/lib/instagram-dashboard/readiness-now";
import { clientConnectLabel, clientReadinessLabel } from "./account-projection";

export async function checkClientAccountReadiness(input: {
  accountId: string;
  userId: string;
  dryRun?: boolean;
}) {
  const supabase = createSupabaseClient();
  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    audience: "client",
    dryRun: input.dryRun === true,
  });
  return {
    status: readiness.client_status,
    message: readiness.client_message || clientReadinessLabel(readiness.client_status, "en"),
    next_action: readiness.next_action,
    reason: readiness.reason,
    connected: readiness.client_status === "connected_ready",
  };
}

export async function connectClientInstagramAccount(input: {
  accountId: string;
  userId: string;
  dryRun?: boolean;
}) {
  const supabase = createSupabaseClient();
  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    audience: "client",
    dryRun: input.dryRun !== true ? false : true,
  });
  const connect = connectNowFromReadiness(readiness);
  return {
    status: connect.status,
    message: connect.message || clientConnectLabel(connect.status, "en"),
    request_queued: connect.request_queued,
    next_action: connect.next_action,
    reason: connect.reason,
    connected: connect.status === "connected",
  };
}
