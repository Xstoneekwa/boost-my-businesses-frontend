import { createSupabaseClient } from "@/lib/supabase";
import { connectNowFromReadiness } from "@/lib/instagram-dashboard/connect-now";
import { runReadinessNow } from "@/lib/instagram-dashboard/readiness-now";
import {
  clientConnectMessage,
  mapReadinessToClientConnectStatus,
  type ClientConnectStatus,
} from "./connect-client-contract";
import {
  clientReadinessAllowsConnect,
  clientReadinessMessage,
  projectClientReadinessStatus,
  type ClientReadinessStatus,
} from "./client-readiness-projection";
import { attachOperationPending, reloadClientAccountSnapshot } from "./client-account-refresh";

const PASSIVE_READINESS_MODE = "readiness_only" as const;
const CONNECT_ENQUEUE_MODE = "connect_enqueue" as const;

export type ClientConnectAccountResult = {
  connectStatus: ClientConnectStatus;
  status: string;
  message: string;
  request_queued: boolean;
  next_action: string;
  reason: string;
  connected: boolean;
  passive_blocked: boolean;
  client_readiness_status?: ClientReadinessStatus;
  account: Awaited<ReturnType<typeof reloadClientAccountSnapshot>> | null;
};

function buildConnectResult(input: {
  connectStatus: ClientConnectStatus;
  readiness: Awaited<ReturnType<typeof runReadinessNow>>;
  connect: ReturnType<typeof connectNowFromReadiness>;
  passiveBlocked: boolean;
  clientReadinessStatus?: ClientReadinessStatus;
  account: ClientConnectAccountResult["account"];
}): ClientConnectAccountResult {
  const requestQueued = input.connectStatus === "queued"
    || input.connectStatus === "already_queued"
    || input.connectStatus === "running"
    || input.connect.request_queued;
  return {
    connectStatus: input.connectStatus,
    status: input.connect.status,
    message: clientConnectMessage(input.connectStatus, "fr"),
    request_queued: requestQueued,
    next_action: input.connect.next_action,
    reason: input.readiness.reason,
    connected: input.connect.status === "connected",
    passive_blocked: input.passiveBlocked,
    client_readiness_status: input.clientReadinessStatus,
    account: input.account,
  };
}

export async function checkClientAccountReadiness(input: {
  accountId: string;
  userId: string;
  clientId: string;
}) {
  const supabase = createSupabaseClient();
  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    audience: "client",
    dryRun: true,
    mode: PASSIVE_READINESS_MODE,
  });
  const clientReadinessStatus = projectClientReadinessStatus(readiness);
  const result = {
    status: clientReadinessStatus,
    message: clientReadinessMessage(clientReadinessStatus, "fr"),
    next_action: readiness.next_action,
    reason: readiness.reason,
    connected: clientReadinessStatus === "already_connected",
    passive: true,
    request_queued: false,
    preflight_request_created: false,
  };
  const snapshot = await reloadClientAccountSnapshot({
    clientId: input.clientId,
    accountId: input.accountId,
  });
  return {
    ...result,
    account: snapshot ? { ...snapshot, clientReadinessStatus } : null,
  };
}

export async function connectClientInstagramAccount(input: {
  accountId: string;
  userId: string;
  clientId: string;
}): Promise<ClientConnectAccountResult> {
  const supabase = createSupabaseClient();
  const passive = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    audience: "client",
    dryRun: true,
    mode: PASSIVE_READINESS_MODE,
  });
  const clientReadinessStatus = projectClientReadinessStatus(passive);

  if (clientReadinessStatus === "already_connected") {
    const snapshot = await reloadClientAccountSnapshot({
      clientId: input.clientId,
      accountId: input.accountId,
    });
    const result = buildConnectResult({
      connectStatus: "running",
      readiness: passive,
      connect: {
        status: "connected",
        reason: "already_connected",
        message: clientReadinessMessage("already_connected", "fr"),
        request_queued: false,
        idempotent: true,
        next_action: "none",
      },
      passiveBlocked: false,
      clientReadinessStatus,
      account: snapshot ? { ...snapshot, clientReadinessStatus } : null,
    });
    return { ...result, message: clientReadinessMessage("already_connected", "fr"), connected: true };
  }

  if (!clientReadinessAllowsConnect(clientReadinessStatus)) {
    const snapshot = await reloadClientAccountSnapshot({
      clientId: input.clientId,
      accountId: input.accountId,
    });
    const result = buildConnectResult({
      connectStatus: "blocked",
      readiness: passive,
      connect: {
        status: "try_again_later",
        reason: "connect_readiness_not_satisfied",
        message: clientReadinessMessage(clientReadinessStatus, "fr"),
        request_queued: false,
        idempotent: false,
        next_action: "check_readiness_again",
      },
      passiveBlocked: true,
      clientReadinessStatus,
      account: snapshot ? { ...snapshot, clientReadinessStatus } : null,
    });
    return { ...result, message: clientReadinessMessage(clientReadinessStatus, "fr") };
  }

  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    audience: "client",
    dryRun: false,
    mode: CONNECT_ENQUEUE_MODE,
  });
  const connect = connectNowFromReadiness(readiness);
  const connectStatus = mapReadinessToClientConnectStatus({
    readiness,
    passiveBlocked: false,
    enqueueRejected: readiness.blockers?.includes("enqueue_rejected") === true,
  });
  const snapshot = await reloadClientAccountSnapshot({
    clientId: input.clientId,
    accountId: input.accountId,
  });
  const result = buildConnectResult({
    connectStatus,
    readiness,
    connect,
    passiveBlocked: false,
    clientReadinessStatus: "ready_to_connect",
    account: attachOperationPending(snapshot, "connect", {
      request_queued: connect.request_queued,
      status: connect.status,
      connectStatus,
    }),
  });
  return result;
}
