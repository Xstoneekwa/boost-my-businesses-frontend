import { releaseDeviceSessionLock } from "./device-session-lock.ts";

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

export const STALE_DEVICE_LOCK_RELEASE_REASON = "stale_device_lock_released_before_preflight" as const;
export const TERMINAL_REQUEST_DEVICE_LOCK_RELEASE_REASON =
  "terminal_request_device_lock_released_before_preflight" as const;

const ACTIVE_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running"]);
const ACTIVE_PREFLIGHT_STATUSES = new Set(["preflight_due", "preflight_running"]);
const TERMINAL_PREFLIGHT_REQUEST_STATUSES = new Set(["failed", "canceled", "cancelled", "completed"]);

function isTerminalPreflightRequestStatus(status: string | null | undefined) {
  return TERMINAL_PREFLIGHT_REQUEST_STATUSES.has(readString(status).toLowerCase());
}

export type StaleDeviceLockReconcileAction =
  | "none"
  | "active_not_released"
  | "released"
  | "ambiguous_not_released"
  | "release_failed";

export type ReconcileStaleDeviceLockResult = {
  action: StaleDeviceLockReconcileAction;
  stale_lock_detected: boolean;
  stale_lock_release_attempted: boolean;
  stale_lock_release_succeeded: boolean;
  lock_was_active_not_released: boolean;
  release_reason: string | null;
  device_id: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  linked_request_id: string | null;
  linked_request_status: string | null;
  linked_preflight_status: string | null;
  ambiguous_lock_state: boolean;
  release_error: string | null;
};

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function emptyResult(): ReconcileStaleDeviceLockResult {
  return {
    action: "none",
    stale_lock_detected: false,
    stale_lock_release_attempted: false,
    stale_lock_release_succeeded: false,
    lock_was_active_not_released: false,
    release_reason: null,
    device_id: null,
    lease_id: null,
    lease_expires_at: null,
    linked_request_id: null,
    linked_request_status: null,
    linked_preflight_status: null,
    ambiguous_lock_state: false,
    release_error: null,
  };
}

function baseDetectedResult(row: Record<string, unknown>, deviceId: string): ReconcileStaleDeviceLockResult {
  return {
    ...emptyResult(),
    stale_lock_detected: true,
    device_id: deviceId,
    lease_id: readString(row.lease_id) || null,
    lease_expires_at: readString(row.lease_expires_at) || null,
    linked_request_id: readString(row.request_id) || null,
  };
}

async function loadRequestStatus(
  supabase: SupabaseLike,
  requestId: string,
): Promise<string | null> {
  const result = await query(supabase, "account_run_requests")
    .select("status")
    .eq("id", requestId)
    .maybeSingle();
  if (result.error || !result.data) return null;
  return readString((result.data as Record<string, unknown>).status) || null;
}

async function loadPreflightStatusByRequest(
  supabase: SupabaseLike,
  requestId: string,
): Promise<string | null> {
  const result = await query(supabase, "scheduled_session_preflights")
    .select("status")
    .eq("request_id", requestId)
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) return null;
  return readString((result.data as Record<string, unknown>).status) || null;
}

function isActiveRequestStatus(status: string | null) {
  return Boolean(status && ACTIVE_REQUEST_STATUSES.has(status.toLowerCase()));
}

function isTerminalPreflightStatus(status: string | null) {
  const normalized = readString(status).toLowerCase();
  return Boolean(normalized && !ACTIVE_PREFLIGHT_STATUSES.has(normalized));
}

function resolveReleaseReason(input: {
  leaseExpired: boolean;
  requestTerminal: boolean;
  preflightTerminal: boolean;
}) {
  if (input.requestTerminal || input.preflightTerminal) {
    return TERMINAL_REQUEST_DEVICE_LOCK_RELEASE_REASON;
  }
  if (input.leaseExpired) {
    return STALE_DEVICE_LOCK_RELEASE_REASON;
  }
  return null;
}

/**
 * Safe preflight-only reconciliation for stale or terminal device UI locks.
 * Never deletes rows directly — uses the audited release RPC only.
 */
export async function reconcileStaleDeviceLockBeforePreflight(
  supabase: SupabaseLike,
  input: {
    deviceId: string;
    accountId?: string | null;
    context?: string;
    now?: Date;
  },
): Promise<ReconcileStaleDeviceLockResult> {
  const deviceId = readString(input.deviceId);
  if (!deviceId) return emptyResult();

  const result = await query(supabase, "auto_restart_device_locks")
    .select("device_id,worker_id,account_id,request_id,run_id,lease_id,lease_expires_at,owner_kind,reason")
    .eq("device_id", deviceId)
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) return emptyResult();

  const row = result.data as Record<string, unknown>;
  const detected = baseDetectedResult(row, deviceId);
  const nowIso = (input.now ?? new Date()).toISOString();
  const leaseExpiresAt = readString(row.lease_expires_at);
  const leaseExpired = !leaseExpiresAt || leaseExpiresAt <= nowIso;
  const workerId = readString(row.worker_id);
  const requestId = readString(row.request_id) || null;

  let linkedRequestStatus: string | null = null;
  let linkedPreflightStatus: string | null = null;
  if (requestId) {
    linkedRequestStatus = await loadRequestStatus(supabase, requestId);
    linkedPreflightStatus = await loadPreflightStatusByRequest(supabase, requestId);
    detected.linked_request_status = linkedRequestStatus;
    detected.linked_preflight_status = linkedPreflightStatus;
  }

  const requestActive = isActiveRequestStatus(linkedRequestStatus);
  const requestTerminal = isTerminalPreflightRequestStatus(linkedRequestStatus);
  const preflightTerminal = isTerminalPreflightStatus(linkedPreflightStatus);

  if (!leaseExpired && requestActive) {
    return {
      ...detected,
      action: "active_not_released",
      lock_was_active_not_released: true,
    };
  }

  const releaseReason = resolveReleaseReason({
    leaseExpired,
    requestTerminal,
    preflightTerminal,
  });

  if (!releaseReason) {
    return {
      ...detected,
      action: "ambiguous_not_released",
      ambiguous_lock_state: true,
      lock_was_active_not_released: !leaseExpired,
    };
  }

  if (!workerId) {
    return {
      ...detected,
      action: "ambiguous_not_released",
      ambiguous_lock_state: true,
      release_error: "missing_worker_id",
    };
  }

  try {
    const release = await releaseDeviceSessionLock(supabase, {
      deviceId,
      workerId,
      requestId,
      releaseReason,
    });
    const released = readBoolean(release.released);
    return {
      ...detected,
      action: released ? "released" : "release_failed",
      stale_lock_release_attempted: true,
      stale_lock_release_succeeded: released,
      release_reason: releaseReason,
      release_error: released ? null : "release_rpc_not_released",
    };
  } catch (error) {
    return {
      ...detected,
      action: "release_failed",
      stale_lock_release_attempted: true,
      release_reason: releaseReason,
      release_error: error instanceof Error ? error.message.slice(0, 200) : "release_rpc_failed",
    };
  }
}

export function buildDeviceLeaseUnavailableReconcileMetadata(
  reconcile: ReconcileStaleDeviceLockResult | null | undefined,
) {
  if (!reconcile?.stale_lock_detected) return {};
  return {
    stale_lock_detected: reconcile.stale_lock_detected,
    stale_lock_release_attempted: reconcile.stale_lock_release_attempted,
    stale_lock_release_succeeded: reconcile.stale_lock_release_succeeded,
    lock_was_active_not_released: reconcile.lock_was_active_not_released,
    device_lease_unavailable_after_reconcile: reconcile.action !== "released",
    reconcile_action: reconcile.action,
    reconcile_release_reason: reconcile.release_reason,
    lease_id: reconcile.lease_id,
    lease_expires_at: reconcile.lease_expires_at,
    linked_request_status: reconcile.linked_request_status,
    linked_preflight_status: reconcile.linked_preflight_status,
    ambiguous_lock_state: reconcile.ambiguous_lock_state,
  };
}
