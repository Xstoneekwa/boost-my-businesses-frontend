import {
  acquireDeviceSessionLock,
  bindDeviceSessionLockToRequest,
  defaultDeviceLockLeaseSeconds,
  getActiveDeviceSessionLock,
  pendingManualLockWorkerId,
  releaseDeviceSessionLock,
  resolveAccountDeviceContext,
  type ActiveDeviceSessionLock,
  type DeviceSessionLockReason,
} from "./device-session-lock.ts";
import {
  preflightLeaseSlotConflict,
  type PreflightLeaseConflictReason,
} from "./scheduled-session-preflight.ts";
import {
  reconcileStaleDeviceLockBeforePreflight,
  type ReconcileStaleDeviceLockResult,
} from "./reconcile-stale-device-lock-before-preflight.ts";

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

export const DEVICE_LEASE_UNAVAILABLE = "device_lease_unavailable" as const;
export const DEVICE_LEASE_OPERATOR_LABEL = "Device currently in use";

export type DeviceUiLeaseProjection = {
  deviceId: string;
  leaseId: string | null;
  status: "available" | "active" | "stale";
  ownerKind: string | null;
  ownerWorkerId: string | null;
  operationPhase: string | null;
  reason: string | null;
  accountId: string | null;
  appInstanceId: string | null;
  requestId: string | null;
  runId: string | null;
  acquiredAt: string | null;
  heartbeatAt: string | null;
  expiresAt: string | null;
  ageSeconds: number | null;
  operatorLabel: string;
  currentOperation: string | null;
};

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readRows(value: unknown) {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

export function mapDeviceLockReasonToLeaseReason(reason: string | null | undefined) {
  const normalized = readString(reason, "");
  if (!normalized || normalized === "device_lock_held") return DEVICE_LEASE_UNAVAILABLE;
  return normalized;
}

export function deviceLeaseOperatorLabel(reason: string | null | undefined) {
  if (mapDeviceLockReasonToLeaseReason(reason) === DEVICE_LEASE_UNAVAILABLE) {
    return DEVICE_LEASE_OPERATOR_LABEL;
  }
  return readString(reason, "Device unavailable");
}

export function runtimeLockFromActiveLease(
  lock: ActiveDeviceSessionLock | null,
  accountDeviceId?: string | null,
) {
  if (!lock) return "none" as const;
  if (accountDeviceId && lock.deviceId !== accountDeviceId) return "none" as const;
  return "device_level_lock" as const;
}

export async function reconcileStaleDeviceUiLeases(
  supabase: SupabaseLike,
  graceSeconds = 0,
) {
  const { data, error } = await supabase.rpc("reconcile_stale_device_ui_leases", {
    p_grace_seconds: graceSeconds,
  });
  if (error) throw new Error(error.message || "device_ui_lease_reconcile_failed");
  return (data ?? {}) as Record<string, unknown>;
}

export async function listActiveDeviceUiLeases(supabase: SupabaseLike) {
  const nowIso = new Date().toISOString();
  const result = await (supabase.from("auto_restart_device_locks") as {
    select: (cols: string) => {
      gt: (col: string, value: string) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
    };
  })
    .select("device_id,lease_id,worker_id,account_id,app_instance_id,request_id,run_id,reason,owner_kind,operation_phase,created_at,heartbeat_at,lease_expires_at")
    .gt("lease_expires_at", nowIso);
  if (result.error) throw new Error(result.error.message || "device_ui_lease_list_failed");
  return readRows(result.data).map(projectDeviceUiLeaseRow);
}

function projectDeviceUiLeaseRow(row: Record<string, unknown>): DeviceUiLeaseProjection {
  const expiresAt = readString(row.lease_expires_at) || null;
  const heartbeatAt = readString(row.heartbeat_at) || readString(row.updated_at) || null;
  const acquiredAt = readString(row.created_at) || null;
  const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : Number.NaN;
  const ageSeconds = Number.isFinite(heartbeatMs)
    ? Math.max(0, Math.round((Date.now() - heartbeatMs) / 1000))
    : null;
  const reason = readString(row.reason, "ui_operation");
  return {
    deviceId: readString(row.device_id),
    leaseId: readString(row.lease_id) || null,
    status: "active",
    ownerKind: readString(row.owner_kind, "worker") || null,
    ownerWorkerId: readString(row.worker_id) || null,
    operationPhase: readString(row.operation_phase, "executing") || null,
    reason,
    accountId: readString(row.account_id) || null,
    appInstanceId: readString(row.app_instance_id) || null,
    requestId: readString(row.request_id) || null,
    runId: readString(row.run_id) || null,
    acquiredAt,
    heartbeatAt,
    expiresAt,
    ageSeconds,
    operatorLabel: DEVICE_LEASE_OPERATOR_LABEL,
    currentOperation: reason.replace(/_/g, " "),
  };
}

export async function projectDeviceUiLease(
  supabase: SupabaseLike,
  deviceId: string,
): Promise<DeviceUiLeaseProjection> {
  const lock = await getActiveDeviceSessionLock(supabase, deviceId);
  if (!lock) {
    return {
      deviceId,
      leaseId: null,
      status: "available",
      ownerKind: null,
      ownerWorkerId: null,
      operationPhase: null,
      reason: null,
      accountId: null,
      appInstanceId: null,
      requestId: null,
      runId: null,
      acquiredAt: null,
      heartbeatAt: null,
      expiresAt: null,
      ageSeconds: null,
      operatorLabel: "Device available",
      currentOperation: null,
    };
  }
  const result = await (supabase.from("auto_restart_device_locks") as {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
      };
    };
  })
    .select("device_id,lease_id,worker_id,account_id,app_instance_id,request_id,run_id,reason,owner_kind,operation_phase,created_at,heartbeat_at,lease_expires_at")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (result.error || !result.data) {
    return projectDeviceUiLeaseRow({
      device_id: lock.deviceId,
      worker_id: lock.workerId,
      account_id: lock.accountId,
      app_instance_id: lock.appInstanceId,
      request_id: lock.requestId,
      reason: lock.reason,
      lease_expires_at: lock.leaseExpiresAt,
    });
  }
  return projectDeviceUiLeaseRow(result.data as Record<string, unknown>);
}

export async function acquireAndBindDeviceUiLeaseForRequest(
  supabase: SupabaseLike,
  input: {
    deviceId: string;
    accountId: string;
    appInstanceId?: string | null;
    requestId: string;
    reason: DeviceSessionLockReason;
    leaseSeconds?: number;
    ownerKind?: string;
    operationPhase?: string;
  },
) {
  const leaseSeconds = input.leaseSeconds ?? defaultDeviceLockLeaseSeconds();
  const lockWorkerId = pendingManualLockWorkerId(input.requestId);
  const acquired = await acquireDeviceSessionLock(supabase, {
    deviceId: input.deviceId,
    workerId: lockWorkerId,
    accountId: input.accountId,
    appInstanceId: input.appInstanceId ?? null,
    leaseSeconds,
    reason: input.reason,
    ownerKind: input.ownerKind ?? "worker",
    operationPhase: input.operationPhase ?? "executing",
  });
  if (!acquired.ok) {
    return {
      ok: false as const,
      reason: mapDeviceLockReasonToLeaseReason(acquired.reason),
      operatorLabel: DEVICE_LEASE_OPERATOR_LABEL,
    };
  }
  const bound = await bindDeviceSessionLockToRequest(supabase, {
    deviceId: input.deviceId,
    workerId: lockWorkerId,
    requestId: input.requestId,
    leaseSeconds,
  });
  if (!bound.ok) {
    await releaseDeviceSessionLock(supabase, {
      deviceId: input.deviceId,
      workerId: lockWorkerId,
      requestId: input.requestId,
      releaseReason: "bind_failed",
    });
    return {
      ok: false as const,
      reason: mapDeviceLockReasonToLeaseReason(bound.reason),
      operatorLabel: DEVICE_LEASE_OPERATOR_LABEL,
    };
  }
  return { ok: true as const, workerId: lockWorkerId };
}

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

async function loadPreflightSlotForLease(
  supabase: SupabaseLike,
  input: { accountId: string; deviceId: string; scheduledWindowStart: string },
) {
  const result = await (supabase.from("scheduled_session_preflights") as QueryBuilder)
    .select("id,status,request_id,scheduled_window_start,business_action_deadline,updated_at")
    .eq("account_id", input.accountId)
    .eq("device_id", input.deviceId)
    .eq("scheduled_window_start", input.scheduledWindowStart)
    .in("status", ["preflight_ready", "preflight_running"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as Record<string, unknown>;
  return {
    id: readString(row.id),
    status: readString(row.status),
    requestId: readString(row.request_id) || null,
    scheduledWindowStart: readString(row.scheduled_window_start) || null,
    businessActionDeadline: readString(row.business_action_deadline) || null,
  };
}

async function cancelLeasedPreflightRequest(
  supabase: SupabaseLike,
  input: {
    deviceId: string;
    requestId: string;
    reason: PreflightLeaseConflictReason;
    reconcile?: ReconcileStaleDeviceLockResult;
  },
) {
  await supabase.rpc("cancel_account_run_request", {
    p_request_id: input.requestId,
    p_reason: input.reason,
  });
  await releaseDeviceUiLeaseForCanceledRequest(supabase, {
    deviceId: input.deviceId,
    requestId: input.requestId,
    releaseReason: input.reason,
  }).catch(() => undefined);
  return {
    ok: false as const,
    reason: input.reason,
    operatorLabel: DEVICE_LEASE_OPERATOR_LABEL,
    reconcile: input.reconcile,
  };
}

export async function releaseDeviceUiLeaseForCanceledRequest(
  supabase: SupabaseLike,
  input: { deviceId: string; requestId: string; releaseReason?: string },
) {
  await releaseDeviceSessionLock(supabase, {
    deviceId: input.deviceId,
    workerId: pendingManualLockWorkerId(input.requestId),
    requestId: input.requestId,
    releaseReason: input.releaseReason ?? "request_canceled",
  });
}

/**
 * CP3.1: acquire + bind the phone UI lease immediately after a request row is
 * created. If the phone is already leased, the freshly created request is
 * cancelled and its (never-bound) lease released so no Worker can ever claim a
 * UI request without a bound lease. Stable refusal: device_lease_unavailable.
 */
export async function leaseRequestOrCancel(
  supabase: SupabaseLike,
  input: {
    deviceId: string;
    accountId: string;
    appInstanceId?: string | null;
    requestId: string;
    reason: DeviceSessionLockReason;
    leaseSeconds?: number;
    ownerKind?: string;
    operationPhase?: string;
    scheduledWindowStart?: string | null;
    now?: Date;
  },
): Promise<
  | { ok: true }
  | {
    ok: false;
    reason: string;
    operatorLabel: string;
    reconcile?: ReconcileStaleDeviceLockResult;
  }
> {
  let reconcile: ReconcileStaleDeviceLockResult | undefined;
  if (input.reason === "scheduled_session_preflight") {
    reconcile = await reconcileStaleDeviceLockBeforePreflight(supabase, {
      deviceId: input.deviceId,
      accountId: input.accountId,
      context: input.operationPhase ?? "cp4_preflight",
    });

    const scheduledWindowStart = readString(input.scheduledWindowStart);
    if (scheduledWindowStart) {
      const slot = await loadPreflightSlotForLease(supabase, {
        accountId: input.accountId,
        deviceId: input.deviceId,
        scheduledWindowStart,
      });
      const conflict = preflightLeaseSlotConflict(slot, {
        scheduledWindowStart,
        requestId: input.requestId,
        now: input.now,
      });
      if (conflict) {
        return cancelLeasedPreflightRequest(supabase, {
          deviceId: input.deviceId,
          requestId: input.requestId,
          reason: conflict,
          reconcile,
        });
      }
    }
  }

  const leased = await acquireAndBindDeviceUiLeaseForRequest(supabase, input);
  if (leased.ok) return { ok: true };

  await supabase.rpc("cancel_account_run_request", {
    p_request_id: input.requestId,
    p_reason: leased.reason,
  });
  await releaseDeviceUiLeaseForCanceledRequest(supabase, {
    deviceId: input.deviceId,
    requestId: input.requestId,
    releaseReason: leased.reason,
  }).catch(() => undefined);
  return {
    ok: false,
    reason: leased.reason,
    operatorLabel: DEVICE_LEASE_OPERATOR_LABEL,
    reconcile,
  };
}

export async function resolveAccountDeviceLeaseBlock(
  supabase: SupabaseLike,
  accountId: string,
  input: {
    requestId?: string | null;
    workerId?: string | null;
    allowSameAccountPreflight?: boolean;
  } = {},
) {
  const deviceContext = await resolveAccountDeviceContext(supabase, accountId);
  if (!deviceContext?.deviceId) return null;
  const activeLock = await getActiveDeviceSessionLock(supabase, deviceContext.deviceId);
  if (!activeLock) return null;
  if (input.requestId && activeLock.requestId === input.requestId) return null;
  if (
    input.workerId
    && activeLock.workerId === input.workerId
    && activeLock.accountId === accountId
  ) {
    return null;
  }
  if (sameAccountPreflightLeaseAllowed(activeLock, accountId, input.allowSameAccountPreflight)) {
    return null;
  }
  return {
    reason: DEVICE_LEASE_UNAVAILABLE,
    operatorLabel: DEVICE_LEASE_OPERATOR_LABEL,
    deviceId: deviceContext.deviceId,
    deviceContext,
  };
}

export function sameAccountPreflightLeaseAllowed(
  activeLock: { accountId?: string | null; ownerKind?: string | null },
  accountId: string,
  allowed: boolean | undefined,
) {
  return allowed === true
    && activeLock.accountId === accountId
    && readString(activeLock.ownerKind).toLowerCase() === "preflight";
}
