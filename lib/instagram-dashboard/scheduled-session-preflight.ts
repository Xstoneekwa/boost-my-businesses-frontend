import {
  deriveSessionTransitionTimestamps,
  isWithinPreflightWindow,
  sessionTransitionMetadata,
  type SessionTransitionTimestamps,
} from "./session-transition-buffer.ts";

export const PREFLIGHT_STATUSES = [
  "preflight_due",
  "preflight_running",
  "preflight_ready",
  "preflight_blocked",
  "preflight_lease_unavailable",
  "preflight_expired",
  "preflight_invalidated",
  "preflight_skipped_scheduler_off",
] as const;

export type ScheduledSessionPreflightStatus = typeof PREFLIGHT_STATUSES[number];

export type ScheduledSessionPreflightRow = {
  id: string;
  account_id: string;
  assignment_id: string;
  device_id: string;
  app_instance_id: string;
  expected_package: string;
  expected_username: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  business_action_deadline: string;
  preflight_start: string;
  status: ScheduledSessionPreflightStatus;
  reason_code: string | null;
  checked_at: string | null;
  expires_at: string;
  lease_id: string | null;
  request_id: string | null;
  metadata_safe: Record<string, unknown>;
};

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  gte: (...args: unknown[]) => QueryBuilder;
  lte: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
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

function mapPreflightRow(row: Record<string, unknown> | null | undefined): ScheduledSessionPreflightRow | null {
  if (!row) return null;
  const id = readString(row.id);
  if (!id) return null;
  return {
    id,
    account_id: readString(row.account_id),
    assignment_id: readString(row.assignment_id),
    device_id: readString(row.device_id),
    app_instance_id: readString(row.app_instance_id),
    expected_package: readString(row.expected_package),
    expected_username: readString(row.expected_username),
    scheduled_window_start: readString(row.scheduled_window_start),
    scheduled_window_end: readString(row.scheduled_window_end),
    business_action_deadline: readString(row.business_action_deadline),
    preflight_start: readString(row.preflight_start),
    status: readString(row.status, "preflight_due") as ScheduledSessionPreflightStatus,
    reason_code: readString(row.reason_code) || null,
    checked_at: readString(row.checked_at) || null,
    expires_at: readString(row.expires_at),
    lease_id: readString(row.lease_id) || null,
    request_id: readString(row.request_id) || null,
    metadata_safe: row.metadata_safe && typeof row.metadata_safe === "object" && !Array.isArray(row.metadata_safe)
      ? (row.metadata_safe as Record<string, unknown>)
      : {},
  };
}

export function preflightOperatorLabel(status: ScheduledSessionPreflightStatus | null | undefined) {
  switch (status) {
    case "preflight_due":
      return "Preflight due";
    case "preflight_running":
      return "Preflight running";
    case "preflight_ready":
      return "Preflight ready";
    case "preflight_blocked":
      return "Preflight blocked";
    case "preflight_lease_unavailable":
      return "Preflight could not acquire device";
    case "preflight_expired":
      return "Preflight expired";
    case "preflight_invalidated":
      return "Preflight invalidated";
    case "preflight_skipped_scheduler_off":
      return "Preflight skipped (Scheduler OFF)";
    default:
      return null;
  }
}

export function deriveAssignmentTransitionTimestamps(startsAt: string, endsAt: string) {
  return deriveSessionTransitionTimestamps(startsAt, endsAt);
}

export function preflightDashboardActionDedupeKey(
  accountId: string,
  assignmentId: string,
  startsAt: string,
) {
  return `account:${accountId}:scheduled_preflight:${assignmentId}:${startsAt}`;
}

export function resolvePreflightDashboardActionStatus(
  terminalStatus: ScheduledSessionPreflightStatus | string,
): "completed" | "action_required" {
  return terminalStatus === "preflight_blocked" ? "action_required" : "completed";
}

export function resolvePreflightExpiresAt(
  timestamps: SessionTransitionTimestamps,
  metadataSafe?: Record<string, unknown>,
) {
  return metadataSafe?.late_preflight === true
    ? timestamps.business_action_deadline
    : timestamps.session_start;
}

export async function reconcilePreflightDashboardAction(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    startsAt: string;
    terminalStatus: ScheduledSessionPreflightStatus | string;
    reasonCode?: string | null;
    source?: string;
    metadataSafe?: Record<string, unknown>;
  },
) {
  const reasonSuffix = input.reasonCode ? ` (${input.reasonCode})` : "";
  const actionStatus = resolvePreflightDashboardActionStatus(input.terminalStatus);
  await supabase.rpc("upsert_account_dashboard_action", {
    p_account_id: input.accountId,
    p_client_id: null,
    p_incident_id: null,
    p_action_type: "scheduled_session_preflight",
    p_status: actionStatus,
    p_title: "Scheduled session preflight",
    p_dedupe_key: preflightDashboardActionDedupeKey(input.accountId, input.assignmentId, input.startsAt),
    p_safe_client_message: null,
    p_admin_message: `Scheduled session preflight terminalized: ${input.terminalStatus}${reasonSuffix}.`,
    p_assistant_message: null,
    p_action_label: actionStatus === "action_required" ? "Review preflight" : "Monitor",
    p_action_deep_link: "/instagram-dashboard/devices",
    p_severity: input.terminalStatus === "preflight_blocked" ? "warning" : "info",
    p_audience: "admin",
    p_requires_client_action: input.terminalStatus === "preflight_blocked",
    p_blocking_campaign: false,
    p_metadata: {
      source: input.source ?? "scheduled_session_preflight",
      assignment_id: input.assignmentId,
      scheduled_session_at: input.startsAt,
      preflight_status: input.terminalStatus,
      ...(input.reasonCode ? { reason_code: input.reasonCode } : {}),
      ...(input.metadataSafe ?? {}),
    },
  });
}

export async function upsertScheduledSessionPreflight(
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
    status?: ScheduledSessionPreflightStatus;
    reasonCode?: string | null;
    metadataSafe?: Record<string, unknown>;
  },
) {
  const timestamps = deriveAssignmentTransitionTimestamps(input.startsAt, input.endsAt);
  if (!timestamps) throw new Error("invalid_session_window");
  const { data, error } = await supabase.rpc("upsert_scheduled_session_preflight", {
    p_account_id: input.accountId,
    p_assignment_id: input.assignmentId,
    p_device_id: input.deviceId,
    p_app_instance_id: input.appInstanceId,
    p_expected_package: input.expectedPackage,
    p_expected_username: input.expectedUsername,
    p_scheduled_window_start: timestamps.session_start,
    p_scheduled_window_end: timestamps.session_end,
    p_business_action_deadline: timestamps.business_action_deadline,
    p_preflight_start: timestamps.preflight_start,
    p_status: input.status ?? "preflight_due",
    p_reason_code: input.reasonCode ?? null,
    p_expires_at: resolvePreflightExpiresAt(timestamps, input.metadataSafe),
    p_metadata_safe: input.metadataSafe ?? {},
  });
  if (error) throw new Error(error.message || "preflight_upsert_failed");
  return mapPreflightRow((Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null);
}

export async function bindScheduledSessionPreflightRequest(
  supabase: SupabaseLike,
  input: { preflightId: string; requestId: string; leaseId?: string | null },
) {
  const { data, error } = await supabase.rpc("bind_scheduled_session_preflight_request", {
    p_preflight_id: input.preflightId,
    p_request_id: input.requestId,
    p_lease_id: input.leaseId ?? null,
  });
  if (error) throw new Error(error.message || "preflight_bind_failed");
  return mapPreflightRow(data as Record<string, unknown> | null);
}

export async function getValidScheduledSessionPreflight(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    deviceId: string;
    appInstanceId: string;
    expectedPackage: string;
    startsAt: string;
    endsAt: string;
    now?: Date;
  },
) {
  const timestamps = deriveAssignmentTransitionTimestamps(input.startsAt, input.endsAt);
  if (!timestamps) return null;
  const { data, error } = await supabase.rpc("get_valid_scheduled_session_preflight", {
    p_account_id: input.accountId,
    p_assignment_id: input.assignmentId,
    p_device_id: input.deviceId,
    p_app_instance_id: input.appInstanceId,
    p_expected_package: input.expectedPackage,
    p_scheduled_window_start: timestamps.session_start,
    p_scheduled_window_end: timestamps.session_end,
    p_now: (input.now ?? new Date()).toISOString(),
  });
  if (error) throw new Error(error.message || "preflight_lookup_failed");
  return mapPreflightRow(data as Record<string, unknown> | null);
}

export async function handoffPreflightLeaseToSchedulerRequest(
  supabase: SupabaseLike,
  input: {
    deviceId: string;
    preflightRequestId: string;
    schedulerRequestId: string;
    workerId: string;
    leaseSeconds?: number;
  },
) {
  const { data, error } = await supabase.rpc("handoff_preflight_device_lock_to_request", {
    p_device_id: input.deviceId,
    p_preflight_request_id: input.preflightRequestId,
    p_scheduler_request_id: input.schedulerRequestId,
    p_new_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds ?? 900,
  });
  if (error) throw new Error(error.message || "preflight_lease_handoff_failed");
  const row = (data ?? null) as Record<string, unknown> | null;
  return {
    ok: row?.ok === true,
    reason: readString(row?.reason) || null,
  };
}

export async function listDevicePreflightReservations(
  supabase: SupabaseLike,
  deviceIds: string[],
) {
  if (!deviceIds.length) return new Map<string, ScheduledSessionPreflightRow>();
  const result = await query(supabase, "scheduled_session_preflights")
    .select("*")
    .in("device_id", deviceIds)
    .in("status", ["preflight_due", "preflight_running", "preflight_ready"])
    .limit(deviceIds.length * 3);
  const map = new Map<string, ScheduledSessionPreflightRow>();
  for (const row of readRows(result.data)) {
    const mapped = mapPreflightRow(row);
    if (mapped?.device_id) map.set(mapped.device_id, mapped);
  }
  return map;
}

export function assignmentIsInPreflightWindow(
  now: Date,
  startsAt: string,
  endsAt: string,
): { eligible: boolean; timestamps: SessionTransitionTimestamps | null } {
  const timestamps = deriveAssignmentTransitionTimestamps(startsAt, endsAt);
  if (!timestamps) return { eligible: false, timestamps: null };
  return { eligible: isWithinPreflightWindow(now, timestamps), timestamps };
}

export function buildSchedulerSessionMetadata(
  input: {
    assignmentId: string;
    workerId: string;
    startsAt: string;
    endsAt: string;
    deviceTimezone: string | null;
    preflightId?: string | null;
  },
) {
  const transition = sessionTransitionMetadata(input.startsAt, input.endsAt);
  return {
    source: "schedule_session_cron",
    trigger: "scheduler",
    assignment_id: input.assignmentId,
    worker_id: input.workerId,
    scheduled_session_at: input.startsAt,
    scheduled_session_ends_at: input.endsAt,
    device_timezone: input.deviceTimezone,
    preflight_id: input.preflightId ?? null,
    ...(transition ?? {}),
  };
}

export function buildPreflightRequestMetadata(
  input: {
    assignmentId: string;
    workerId: string;
    startsAt: string;
    endsAt: string;
    preflightId: string;
    phase: string;
  },
) {
  const transition = sessionTransitionMetadata(input.startsAt, input.endsAt);
  return {
    source: "login_preflight_cron",
    trigger: "scheduled_session_preflight",
    assignment_id: input.assignmentId,
    worker_id: input.workerId,
    preflight_id: input.preflightId,
    phase: input.phase,
    scheduled_session_at: input.startsAt,
    scheduled_session_ends_at: input.endsAt,
    verification_only: true,
    ...(transition ?? {}),
  };
}
