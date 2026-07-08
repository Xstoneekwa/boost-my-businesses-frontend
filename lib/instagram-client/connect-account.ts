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
import { clientProvisioningSlotReservationsEnabled } from "@/lib/instagram-dashboard/client-provisioning-slot-feature";
import { evaluatePhoneIdleForClientConnect } from "@/lib/instagram-dashboard/evaluate-phone-idle-for-client-connect";
import {
  consumeProvisioningReservation,
  isProvisioningWindowOpen,
  loadActiveProvisioningReservationForAccount,
  reserveOrReturnProvisioningSlot,
} from "@/lib/instagram-dashboard/client-provisioning-slot-reservations";
import {
  buildProvisioningSlotClientProjection,
  clientProvisioningSlotMessage,
  type ClientProvisioningSlotLang,
} from "./client-provisioning-slot-messages";

const PASSIVE_READINESS_MODE = "readiness_only" as const;
const ACTIVE_CONNECT_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running"]);

export type ClientProvisioningSlotProjection = ReturnType<typeof buildProvisioningSlotClientProjection>;

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
  provisioning_slot?: ClientProvisioningSlotProjection | null;
  account: Awaited<ReturnType<typeof reloadClientAccountSnapshot>> | null;
};

function buildConnectResult(input: {
  connectStatus: ClientConnectStatus;
  readiness: Awaited<ReturnType<typeof runReadinessNow>>;
  connect: ReturnType<typeof connectNowFromReadiness>;
  passiveBlocked: boolean;
  clientReadinessStatus?: ClientReadinessStatus;
  account: ClientConnectAccountResult["account"];
  lang: ClientProvisioningSlotLang;
  provisioningSlot?: ClientProvisioningSlotProjection | null;
  messageOverride?: string;
}): ClientConnectAccountResult {
  const requestQueued = input.connectStatus === "queued"
    || input.connectStatus === "already_queued"
    || input.connectStatus === "running"
    || input.connect.request_queued;
  return {
    connectStatus: input.connectStatus,
    status: input.connect.status,
    message: input.messageOverride || clientConnectMessage(input.connectStatus, input.lang),
    request_queued: requestQueued,
    next_action: input.connect.next_action,
    reason: input.readiness.reason,
    connected: input.connect.status === "connected",
    passive_blocked: input.passiveBlocked,
    client_readiness_status: input.clientReadinessStatus,
    provisioning_slot: input.provisioningSlot ?? null,
    account: input.account,
  };
}

async function buildReservationBlockedResult(input: {
  clientId: string;
  accountId: string;
  userId: string;
  lang: ClientProvisioningSlotLang;
  assignment: Record<string, unknown>;
  now?: Date;
}): Promise<ClientConnectAccountResult> {
  const supabase = createSupabaseClient();
  const now = input.now ?? new Date();
  const reserve = await reserveOrReturnProvisioningSlot(supabase, {
    clientId: input.clientId,
    igAccountId: input.accountId,
    assignmentId: readString(input.assignment.id),
    deviceId: readString(input.assignment.device_id),
    appInstanceId: readString(input.assignment.app_instance_id),
    now,
  });

  const snapshot = await reloadClientAccountSnapshot({
    clientId: input.clientId,
    accountId: input.accountId,
  });

  if (!reserve.ok) {
    const readiness: ReadinessNowResult = {
      audience: "client",
      readiness_status: "retry_later",
      client_status: "try_again_later",
      client_message: clientProvisioningSlotMessage("noSlotAvailable", input.lang),
      preflight_request_created: false,
      idempotent: false,
      next_action: "request_assisted_connect",
      reason: reserve.reason,
      blockers: ["no_safe_provisioning_slot"],
    };
    return buildConnectResult({
      connectStatus: "blocked",
      readiness,
      connect: {
        status: "try_again_later",
        reason: reserve.reason,
        message: clientProvisioningSlotMessage("noSlotAvailable", input.lang),
        request_queued: false,
        idempotent: false,
        next_action: "request_assisted_connect",
      },
      passiveBlocked: true,
      clientReadinessStatus: "provisioning_slot_unavailable",
      account: snapshot ? { ...snapshot, clientReadinessStatus: "provisioning_slot_unavailable" } : null,
      lang: input.lang,
      messageOverride: clientProvisioningSlotMessage("noSlotAvailable", input.lang),
    });
  }

  const projection = buildProvisioningSlotClientProjection({
    reservation: reserve.reservation,
    lang: input.lang,
    now,
  });
  const readiness: ReadinessNowResult = {
    audience: "client",
    readiness_status: "retry_later",
    client_status: "try_again_later",
    client_message: projection.body,
    preflight_request_created: false,
    idempotent: reserve.idempotent,
    next_action: projection.window_open ? "connect_when_ready" : "wait_for_reserved_slot",
    reason: "provisioning_slot_reserved",
    blockers: ["phones_busy_reserved_slot"],
  };

  return buildConnectResult({
    connectStatus: "blocked",
    readiness,
    connect: {
      status: "try_again_later",
      reason: "provisioning_slot_reserved",
      message: projection.body,
      request_queued: false,
      idempotent: reserve.idempotent,
      next_action: projection.window_open ? "connect_when_ready" : "wait_for_reserved_slot",
    },
    passiveBlocked: !projection.window_open,
    clientReadinessStatus: projection.window_open ? "provisioning_slot_open" : "provisioning_slot_reserved",
    account: snapshot ? {
      ...snapshot,
      clientReadinessStatus: projection.window_open ? "provisioning_slot_open" : "provisioning_slot_reserved",
    } : null,
    lang: input.lang,
    provisioningSlot: projection,
    messageOverride: projection.body,
  });
}

export async function checkClientAccountReadiness(input: {
  accountId: string;
  userId: string;
  clientId: string;
  lang?: ClientProvisioningSlotLang;
}) {
  const lang = input.lang ?? "fr";
  const supabase = createSupabaseClient();
  await retryOnboardingAutoAssignmentIfPending(input.accountId);
  const readiness = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    audience: "client",
    dryRun: true,
    mode: PASSIVE_READINESS_MODE,
  });
  let clientReadinessStatus = projectClientReadinessStatus(readiness);
  let provisioningSlot: ClientProvisioningSlotProjection | null = null;

  if (clientProvisioningSlotReservationsEnabled()) {
    const reservation = await loadActiveProvisioningReservationForAccount(supabase, input.accountId);
    if (reservation) {
      provisioningSlot = buildProvisioningSlotClientProjection({ reservation, lang });
      clientReadinessStatus = provisioningSlot.window_open
        ? "provisioning_slot_open"
        : provisioningSlot.status === "expired"
          ? "provisioning_slot_expired"
          : "provisioning_slot_reserved";
    }
  }

  const result = {
    status: clientReadinessStatus,
    message: provisioningSlot?.body || clientReadinessMessage(clientReadinessStatus, lang),
    next_action: readiness.next_action,
    reason: readiness.reason,
    connected: clientReadinessStatus === "already_connected",
    passive: true,
    request_queued: false,
    preflight_request_created: false,
    provisioning_slot: provisioningSlot,
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
  lang?: ClientProvisioningSlotLang;
}): Promise<ClientConnectAccountResult> {
  const lang = input.lang ?? "fr";
  const supabase = createSupabaseClient();
  const passive = await runReadinessNow(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    audience: "client",
    dryRun: true,
    mode: PASSIVE_READINESS_MODE,
  });
  let clientReadinessStatus = projectClientReadinessStatus(passive);

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
        message: clientReadinessMessage("already_connected", lang),
        request_queued: false,
        idempotent: true,
        next_action: "none",
      },
      passiveBlocked: false,
      clientReadinessStatus,
      account: snapshot ? { ...snapshot, clientReadinessStatus } : null,
      lang,
    });
    return { ...result, message: clientReadinessMessage("already_connected", lang), connected: true };
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
      client_message: clientReadinessMessage("preparation_pending", lang),
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
        message: clientReadinessMessage("preparation_pending", lang),
        request_queued: false,
        idempotent: false,
        next_action: "check_readiness_again",
      },
      passiveBlocked: true,
      clientReadinessStatus: "preparation_pending",
      account: snapshot ? { ...snapshot, clientReadinessStatus: "preparation_pending" } : null,
      lang,
      messageOverride: clientReadinessMessage("preparation_pending", lang),
    });
  }

  const cp6Enabled = clientProvisioningSlotReservationsEnabled();
  let activeReservation = cp6Enabled
    ? await loadActiveProvisioningReservationForAccount(supabase, input.accountId)
    : null;

  if (cp6Enabled) {
    const idleNow = await evaluatePhoneIdleForClientConnect(supabase, {
      accountId: input.accountId,
      assignmentId: readString(assignment.id),
      deviceId: readString(assignment.device_id),
      appInstanceId: readString(assignment.app_instance_id),
    });

    if (!idleNow.idle) {
      return buildReservationBlockedResult({
        clientId: input.clientId,
        accountId: input.accountId,
        userId: input.userId,
        lang,
        assignment,
      });
    }

    if (activeReservation && !isProvisioningWindowOpen(activeReservation)) {
      return buildReservationBlockedResult({
        clientId: input.clientId,
        accountId: input.accountId,
        userId: input.userId,
        lang,
        assignment,
      });
    }

    if (activeReservation && isProvisioningWindowOpen(activeReservation)) {
      clientReadinessStatus = "provisioning_slot_open";
    }
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
        message: clientReadinessMessage(clientReadinessStatus, lang),
        request_queued: false,
        idempotent: false,
        next_action: "check_readiness_again",
      },
      passiveBlocked: true,
      clientReadinessStatus,
      account: snapshot ? { ...snapshot, clientReadinessStatus } : null,
      lang,
      messageOverride: clientReadinessMessage(clientReadinessStatus, lang),
    });
    return result;
  }

  if (cp6Enabled) {
    const idleConfirm = await evaluatePhoneIdleForClientConnect(supabase, {
      accountId: input.accountId,
      assignmentId: readString(assignment.id),
      deviceId: readString(assignment.device_id),
      appInstanceId: readString(assignment.app_instance_id),
      excludeProvisioningReservationId: activeReservation?.id ?? null,
    });
    if (!idleConfirm.idle) {
      return buildReservationBlockedResult({
        clientId: input.clientId,
        accountId: input.accountId,
        userId: input.userId,
        lang,
        assignment,
      });
    }
  }

  const deadline = deadlineForClientConnectAssignment(assignment);
  const enqueue = await enqueueClientConnectRequest(supabase, {
    accountId: input.accountId,
    actorId: input.userId,
    assignmentId: readString(assignment.id),
    deadlineAt: deadline.toISOString(),
    deviceId: readString(assignment.device_id) || null,
    appInstanceId: readString(assignment.app_instance_id) || null,
  });

  if (cp6Enabled && activeReservation && enqueue.preflight_request_created) {
    try {
      await consumeProvisioningReservation(supabase, activeReservation.id, input.accountId);
    } catch {
      // Best-effort; connect already queued.
    }
  }

  const requestStatus = readString(enqueue.run_request_status).toLowerCase();
  const requestActive = ACTIVE_CONNECT_REQUEST_STATUSES.has(requestStatus);
  const readiness: ReadinessNowResult = {
    audience: "client",
    readiness_status: requestActive ? "checking_connection" : "retry_later",
    client_status: requestActive ? "checking_connection" : "try_again_later",
    client_message: requestActive
      ? (lang === "fr" ? "Connexion en cours" : "Connection in progress")
      : clientReadinessMessage("ready_to_connect", lang),
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
    lang,
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
