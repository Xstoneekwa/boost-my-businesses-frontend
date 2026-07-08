import { getActiveOperatorStopSuppression } from "./operator-stop-suppression.ts";
import {
  bindScheduledSessionPreflightRequest,
  buildPreflightRequestMetadata,
  deriveAssignmentTransitionTimestamps,
  getValidScheduledSessionPreflight,
  upsertScheduledSessionPreflight,
  type ScheduledSessionPreflightRow,
  type ScheduledSessionPreflightStatus,
} from "./scheduled-session-preflight.ts";
import {
  isBusinessActionsAllowed,
  type SessionTransitionTimestamps,
} from "./session-transition-buffer.ts";

export const MIN_LATE_PREFLIGHT_RUNWAY_MINUTES = 10;
export const LATE_PREFLIGHT_RUN_TYPE = "scheduled_session_preflight";
export const LATE_PREFLIGHT_SOURCE_SURFACE = "instagram_login_preflight_cron";

export type LateActiveWindowPreflightReason =
  | "late_preflight_started"
  | "late_preflight_ready"
  | "late_preflight_blocked"
  | "late_preflight_unavailable"
  | "late_preflight_too_close_to_deadline"
  | "skipped_preflight_missing"
  | "scheduler_disabled"
  | "outside_active_window"
  | "stale_device_heartbeat"
  | "device_lease_unavailable"
  | "stop_cleanup_in_progress"
  | "operator_stop_suppressed"
  | "provisioning_reservation_conflict"
  | "active_request_present"
  | "active_run_present"
  | "skipped_phone_busy"
  | "invalid_session_window";

export type EnsureLateActiveWindowPreflightResult =
  | { ok: true; outcome: "started"; preflightId: string; requestId: string | null; reason: "late_preflight_started" }
  | { ok: true; outcome: "already_ready"; preflightId: string; requestId: string; reason: "late_preflight_ready" }
  | { ok: true; outcome: "already_running"; preflightId: string | null; requestId: string | null; reason: "late_preflight_started" }
  | { ok: false; reason: LateActiveWindowPreflightReason };

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder & PromiseLike<QueryResult>;
  maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

export function scheduledPreflightIdempotencyKey(assignmentId: string, startsAt: string) {
  return `scheduled-preflight:${assignmentId}:${startsAt}`;
}

export function hasLatePreflightRunway(
  transition: SessionTransitionTimestamps,
  now: Date,
  runwayMinutes = MIN_LATE_PREFLIGHT_RUNWAY_MINUTES,
) {
  const deadlineMs = Date.parse(transition.business_action_deadline);
  if (!Number.isFinite(deadlineMs)) return false;
  return now.getTime() + Math.max(1, runwayMinutes) * 60_000 <= deadlineMs;
}

export function isLateActiveWindowEligible(
  transition: SessionTransitionTimestamps,
  now: Date,
  runwayMinutes = MIN_LATE_PREFLIGHT_RUNWAY_MINUTES,
) {
  const sessionStartMs = Date.parse(transition.session_start);
  if (!Number.isFinite(sessionStartMs)) return false;
  if (now.getTime() < sessionStartMs) return false;
  if (!isBusinessActionsAllowed(now, transition)) return false;
  return hasLatePreflightRunway(transition, now, runwayMinutes);
}

export function lateActiveWindowBlockReason(
  transition: SessionTransitionTimestamps,
  now: Date,
  runwayMinutes = MIN_LATE_PREFLIGHT_RUNWAY_MINUTES,
): LateActiveWindowPreflightReason {
  const sessionStartMs = Date.parse(transition.session_start);
  if (!Number.isFinite(sessionStartMs) || now.getTime() < sessionStartMs) {
    return "outside_active_window";
  }
  if (!isBusinessActionsAllowed(now, transition) || !hasLatePreflightRunway(transition, now, runwayMinutes)) {
    return "late_preflight_too_close_to_deadline";
  }
  return "outside_active_window";
}

export function resolveExistingPreflightDisposition(
  existing: { status?: string; request_id?: string | null } | null | undefined,
): EnsureLateActiveWindowPreflightResult | null {
  const status = readString(existing?.status) as ScheduledSessionPreflightStatus;
  const requestId = readString(existing?.request_id) || null;
  if (status === "preflight_ready" && requestId) {
    return {
      ok: true,
      outcome: "already_ready",
      preflightId: readString((existing as Record<string, unknown>)?.id) || "unknown",
      requestId,
      reason: "late_preflight_ready",
    };
  }
  if (status === "preflight_blocked") {
    return { ok: false, reason: "late_preflight_blocked" };
  }
  if (["preflight_due", "preflight_running"].includes(status) && requestId) {
    return {
      ok: true,
      outcome: "already_running",
      preflightId: readString((existing as Record<string, unknown>)?.id) || null,
      requestId,
      reason: "late_preflight_started",
    };
  }
  return null;
}

async function loadExistingPreflightForWindow(
  supabase: SupabaseLike,
  input: {
    assignmentId: string;
    sessionStart: string;
  },
) {
  const result = await query(supabase, "scheduled_session_preflights")
    .select("id,status,request_id,reason_code,metadata_safe")
    .eq("assignment_id", input.assignmentId)
    .eq("scheduled_window_start", input.sessionStart)
    .limit(1)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "preflight_lookup_failed");
  const row = (result.data ?? null) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    id: readString(row.id),
    status: readString(row.status),
    request_id: readString(row.request_id) || null,
    reason_code: readString(row.reason_code) || null,
    metadata_safe: row.metadata_safe,
  };
}

async function hasProvisioningReservationConflict(
  supabase: SupabaseLike,
  input: { deviceId: string; now: Date; windowEndMs: number },
) {
  const result = await query(supabase, "client_provisioning_slot_reservations")
    .select("id,window_start_utc,window_end_utc,status")
    .eq("device_id", input.deviceId)
    .in("status", ["reserved", "window_open", "assisted_requested"])
    .limit(20) as unknown as QueryResult;
  if (result.error) throw new Error(result.error.message || "provisioning_reservation_unavailable");
  const nowMs = input.now.getTime();
  for (const row of readRows(result.data)) {
    const start = Date.parse(readString(row.window_start_utc));
    const end = Date.parse(readString(row.window_end_utc));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (nowMs < end && input.windowEndMs > start) return true;
  }
  return false;
}

async function queueLatePreflightRequest(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    startsAt: string;
    endsAt: string;
    workerId: string;
    preflightId: string;
  },
) {
  const { data, error } = await supabase.rpc("create_account_run_request", {
    p_account_id: input.accountId,
    p_requested_by: null,
    p_actor_type: "system",
    p_source_surface: LATE_PREFLIGHT_SOURCE_SURFACE,
    p_requested_run_type: LATE_PREFLIGHT_RUN_TYPE,
    p_idempotency_key: scheduledPreflightIdempotencyKey(input.assignmentId, input.startsAt),
    p_priority: 1,
    p_metadata_safe: {
      ...buildPreflightRequestMetadata({
        assignmentId: input.assignmentId,
        workerId: input.workerId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        preflightId: input.preflightId,
        phase: "late",
      }),
      late_preflight: true,
      late_preflight_phase: "active_window_recovery",
    },
  });
  if (error) throw new Error(error.message || "late_preflight_enqueue_failed");
  const requestRow = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return readString(requestRow?.id) || null;
}

export async function ensureLateActiveWindowPreflight(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    deviceId: string;
    appInstanceId: string;
    expectedPackage: string;
    expectedUsername: string;
    startsAt: string;
    endsAt: string;
    workerId: string;
    now: Date;
    schedulerEnabled: boolean;
    heartbeatLastSeenAt?: string | null;
    heartbeatStatus?: string | null;
    heartbeatStaleMs?: number;
    activeRequestAccounts?: Set<string>;
    activeRunAccounts?: Set<string>;
    activeRequestKeys?: Set<string>;
    peerBusyAccountIds?: string[];
  },
): Promise<EnsureLateActiveWindowPreflightResult> {
  if (!input.schedulerEnabled) {
    return { ok: false, reason: "scheduler_disabled" };
  }

  const transition = deriveAssignmentTransitionTimestamps(input.startsAt, input.endsAt);
  if (!transition) {
    return { ok: false, reason: "invalid_session_window" };
  }
  if (!isLateActiveWindowEligible(transition, input.now)) {
    return { ok: false, reason: lateActiveWindowBlockReason(transition, input.now) };
  }

  const readyPreflight = await getValidScheduledSessionPreflight(supabase, {
    accountId: input.accountId,
    assignmentId: input.assignmentId,
    deviceId: input.deviceId,
    appInstanceId: input.appInstanceId,
    expectedPackage: input.expectedPackage,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    now: input.now,
  });
  if (readyPreflight?.request_id) {
    return {
      ok: true,
      outcome: "already_ready",
      preflightId: readyPreflight.id,
      requestId: readyPreflight.request_id,
      reason: "late_preflight_ready",
    };
  }

  const existing = await loadExistingPreflightForWindow(supabase, {
    assignmentId: input.assignmentId,
    sessionStart: transition.session_start,
  });
  const existingDisposition = resolveExistingPreflightDisposition(existing);
  if (existingDisposition) return existingDisposition;

  const heartbeatStaleMs = input.heartbeatStaleMs ?? 15 * 60 * 1000;
  const lastSeenAt = readString(input.heartbeatLastSeenAt);
  const heartbeatStatus = readString(input.heartbeatStatus).toLowerCase();
  const lastSeenMs = Date.parse(lastSeenAt);
  if (
    heartbeatStatus !== "online"
    || !Number.isFinite(lastSeenMs)
    || input.now.getTime() - lastSeenMs > heartbeatStaleMs
  ) {
    return { ok: false, reason: "stale_device_heartbeat" };
  }

  if (input.activeRequestAccounts?.has(input.accountId)) {
    return { ok: false, reason: "active_request_present" };
  }
  if (input.activeRunAccounts?.has(input.accountId)) {
    return { ok: false, reason: "active_run_present" };
  }
  const idempotencyKey = scheduledPreflightIdempotencyKey(input.assignmentId, input.startsAt);
  if (input.activeRequestKeys?.has(idempotencyKey)) {
    return { ok: false, reason: "active_request_present" };
  }
  if (input.peerBusyAccountIds?.length) {
    return { ok: false, reason: "skipped_phone_busy" };
  }

  const suppression = await getActiveOperatorStopSuppression(supabase, input.accountId, input.now);
  if (suppression) {
    const reason = readString(suppression.reason_code) === "operator_stop_suppressed"
      ? "operator_stop_suppressed"
      : "stop_cleanup_in_progress";
    return { ok: false, reason };
  }

  const { getActiveDeviceSessionLock } = await import("./device-session-lock.ts");
  const activeDeviceLease = await getActiveDeviceSessionLock(supabase, input.deviceId);
  if (
    activeDeviceLease
    && activeDeviceLease.ownerKind !== "preflight"
    && activeDeviceLease.accountId !== input.accountId
  ) {
    return { ok: false, reason: "device_lease_unavailable" };
  }

  const windowEndMs = Date.parse(transition.session_end);
  if (await hasProvisioningReservationConflict(supabase, {
    deviceId: input.deviceId,
    now: input.now,
    windowEndMs: Number.isFinite(windowEndMs) ? windowEndMs : input.now.getTime(),
  })) {
    return { ok: false, reason: "provisioning_reservation_conflict" };
  }

  const preflightRow = await upsertScheduledSessionPreflight(supabase, {
    accountId: input.accountId,
    assignmentId: input.assignmentId,
    deviceId: input.deviceId,
    appInstanceId: input.appInstanceId,
    expectedPackage: input.expectedPackage,
    expectedUsername: input.expectedUsername,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: "preflight_due",
    metadataSafe: {
      late_preflight: true,
      late_preflight_started_at: input.now.toISOString(),
      source: "schedule_session_cron",
    },
  });
  if (!preflightRow?.id) {
    return { ok: false, reason: "late_preflight_unavailable" };
  }

  const requestId = await queueLatePreflightRequest(supabase, {
    accountId: input.accountId,
    assignmentId: input.assignmentId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    workerId: input.workerId,
    preflightId: preflightRow.id,
  });
  if (!requestId) {
    return { ok: false, reason: "late_preflight_unavailable" };
  }

  const { leaseRequestOrCancel } = await import("./device-ui-lease.ts");
  const leased = await leaseRequestOrCancel(supabase, {
    deviceId: input.deviceId,
    accountId: input.accountId,
    appInstanceId: input.appInstanceId,
    requestId,
    reason: "scheduled_session_preflight",
    ownerKind: "preflight",
    operationPhase: "queued",
  });
  if (!leased.ok) {
    await upsertScheduledSessionPreflight(supabase, {
      accountId: input.accountId,
      assignmentId: input.assignmentId,
      deviceId: input.deviceId,
      appInstanceId: input.appInstanceId,
      expectedPackage: input.expectedPackage,
      expectedUsername: input.expectedUsername,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "preflight_lease_unavailable",
      reasonCode: "device_lease_unavailable",
      metadataSafe: { late_preflight: true },
    });
    return { ok: false, reason: "device_lease_unavailable" };
  }

  await bindScheduledSessionPreflightRequest(supabase, {
    preflightId: preflightRow.id,
    requestId,
  });

  return {
    ok: true,
    outcome: "started",
    preflightId: preflightRow.id,
    requestId,
    reason: "late_preflight_started",
  };
}

export function mapLatePreflightReasonToOperatorLabel(reason: LateActiveWindowPreflightReason) {
  switch (reason) {
    case "late_preflight_started":
      return "Late preflight started";
    case "late_preflight_ready":
      return "Late preflight ready";
    case "late_preflight_blocked":
      return "Late preflight blocked";
    case "late_preflight_unavailable":
      return "Late preflight unavailable";
    case "late_preflight_too_close_to_deadline":
      return "Too close to business deadline";
    case "skipped_preflight_missing":
      return "Preflight missing";
    case "scheduler_disabled":
      return "Scheduler disabled";
    case "outside_active_window":
      return "Outside active window";
    case "stale_device_heartbeat":
      return "Phone heartbeat stale";
    case "device_lease_unavailable":
      return "Device currently in use";
    case "stop_cleanup_in_progress":
      return "Stop cleanup in progress";
    case "operator_stop_suppressed":
      return "Stopped by operator";
    case "provisioning_reservation_conflict":
      return "Provisioning reservation conflict";
    case "active_request_present":
      return "Run already requested";
    case "active_run_present":
      return "Run already active";
    case "skipped_phone_busy":
      return "Phone busy";
    case "invalid_session_window":
      return "Invalid session window";
    default:
      return "Late preflight unavailable";
  }
}

export type { ScheduledSessionPreflightRow, SessionTransitionTimestamps };
