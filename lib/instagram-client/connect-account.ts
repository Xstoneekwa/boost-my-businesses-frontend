import { createSupabaseClient } from "@/lib/supabase";
import { connectNowFromReadiness } from "@/lib/instagram-dashboard/connect-now";
import { runReadinessNow, type ReadinessNowResult } from "@/lib/instagram-dashboard/readiness-now";
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
import { retryOnboardingAutoAssignmentIfPending } from "@/lib/instagram-dashboard/onboarding-schedule";
import { attachOperationPending, reloadClientAccountSnapshot } from "./client-account-refresh";
import {
  deadlineForClientConnectAssignment,
  enqueueClientConnectRequest,
  loadClientConnectAssignment,
} from "./enqueue-client-connect";
import { createConnectOperationToken } from "./connect-operation-token";
import { readString } from "./guards";

const PASSIVE_READINESS_MODE = "readiness_only" as const;
const ACTIVE_CONNECT_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running"]);

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
  connect_operation_token?: string | null;
  connect_operation_expires_at?: string | null;
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
  await retryOnboardingAutoAssignmentIfPending(input.accountId);
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

  const assignment = await loadClientConnectAssignment(supabase, input.accountId);
  if (!assignment) {
    const snapshot = await reloadClientAccountSnapshot({
      clientId: input.clientId,
      accountId: input.accountId,
    });
    const blockedReadiness: ReadinessNowResult = {
      audience: "client",
      readiness_status: "retry_later",
      client_status: "try_again_later",
      client_message: clientReadinessMessage("preparation_pending", "fr"),
      preflight_request_created: false,
      idempotent: false,
      next_action: "check_readiness_again",
      reason: "missing_assignment",
      blockers: ["missing_assignment"],
    };
    return buildConnectResult({
      connectStatus: "blocked",
      readiness: blockedReadiness,
      connect: {
        status: "try_again_later",
        reason: "missing_assignment",
        message: clientReadinessMessage("preparation_pending", "fr"),
        request_queued: false,
        idempotent: false,
        next_action: "check_readiness_again",
      },
      passiveBlocked: true,
      clientReadinessStatus: "preparation_pending",
      account: snapshot ? { ...snapshot, clientReadinessStatus: "preparation_pending" } : null,
    });
  }

  const deadline = deadlineForClientConnectAssignment(assignment);
  const enqueue = await enqueueClientConnectRequest(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    assignmentId: readString(assignment.id),
    deadlineAt: deadline.toISOString(),
  });
  const requestStatus = readString(enqueue.run_request_status).toLowerCase();
  const requestActive = ACTIVE_CONNECT_REQUEST_STATUSES.has(requestStatus);
  const readiness: ReadinessNowResult = {
    audience: "client",
    readiness_status: requestActive ? "checking_connection" : "retry_later",
    client_status: requestActive ? "checking_connection" : "try_again_later",
    client_message: requestActive
      ? "Connexion en cours"
      : clientReadinessMessage("ready_to_connect", "fr"),
    preflight_request_created: enqueue.preflight_request_created,
    idempotent: enqueue.idempotent,
    next_action: requestActive ? "monitor_preflight" : "retry_connect",
    reason: enqueue.reason,
    blockers: enqueue.blockers,
    run_request_status: enqueue.run_request_status,
    request_id: enqueue.request_id,
  };
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
  const operationToken = readString(enqueue.connect_attempt_id)
    ? createConnectOperationToken({
      accountId: input.accountId,
      actorUserId: input.userId,
      connectAttemptId: readString(enqueue.connect_attempt_id),
      requestId: enqueue.request_id,
    })
    : null;
  return {
    ...result,
    connect_operation_token: operationToken?.connect_operation_token ?? null,
    connect_operation_expires_at: operationToken?.expires_at ?? null,
  };
}
