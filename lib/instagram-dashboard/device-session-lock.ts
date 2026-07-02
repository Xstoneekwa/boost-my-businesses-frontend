type SupabaseRecord = Record<string, unknown>;

type SupabaseFromLike = {
  from: (table: string) => unknown;
};

type SupabaseLike = SupabaseFromLike & {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

export type DeviceSessionLockReason = "auto_restart" | "manual_run" | "account_session";

export type ActiveDeviceSessionLock = {
  deviceId: string;
  workerId: string;
  accountId: string | null;
  appInstanceId: string | null;
  requestId: string | null;
  reason: string;
  leaseExpiresAt: string;
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

function query(supabase: SupabaseFromLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

export async function resolveAccountDeviceContext(
  supabase: SupabaseFromLike,
  accountId: string,
): Promise<{ deviceId: string; appInstanceId: string | null } | null> {
  const result = await query(supabase, "account_assignments")
    .select("device_id,app_instance_id,status")
    .eq("account_id", accountId)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as SupabaseRecord;
  const deviceId = readString(row.device_id);
  if (!deviceId) return null;
  return {
    deviceId,
    appInstanceId: readString(row.app_instance_id) || null,
  };
}

export async function getActiveDeviceSessionLock(
  supabase: SupabaseFromLike,
  deviceId: string,
): Promise<ActiveDeviceSessionLock | null> {
  const nowIso = new Date().toISOString();
  const result = await query(supabase, "auto_restart_device_locks")
    .select("device_id,worker_id,account_id,app_instance_id,request_id,reason,lease_expires_at")
    .eq("device_id", deviceId)
    .limit(1)
    .maybeSingle();
  if (result.error || !result.data) return null;
  const row = result.data as SupabaseRecord;
  const lease = readString(row.lease_expires_at);
  if (!lease || lease <= nowIso) return null;
  return {
    deviceId: readString(row.device_id),
    workerId: readString(row.worker_id),
    accountId: readString(row.account_id) || null,
    appInstanceId: readString(row.app_instance_id) || null,
    requestId: readString(row.request_id) || null,
    reason: readString(row.reason, "device_session"),
    leaseExpiresAt: lease,
  };
}

export function deviceSessionLockBlocksStart(
  lock: ActiveDeviceSessionLock | null,
  input: {
    accountId?: string | null;
    requestId?: string | null;
    workerId?: string | null;
  } = {},
) {
  if (!lock) return null;
  if (input.requestId && lock.requestId === input.requestId) return null;
  if (input.workerId && lock.workerId === input.workerId && input.accountId && lock.accountId === input.accountId) {
    return null;
  }
  return "device_lock_held" as const;
}

export async function acquireDeviceSessionLock(
  supabase: SupabaseLike,
  input: {
    deviceId: string;
    workerId: string;
    accountId: string;
    appInstanceId?: string | null;
    leaseSeconds: number;
    reason: DeviceSessionLockReason;
  },
) {
  const { data, error } = await supabase.rpc("auto_restart_acquire_device_lock", {
    p_device_id: input.deviceId,
    p_worker_id: input.workerId,
    p_account_id: input.accountId,
    p_app_instance_id: input.appInstanceId ?? null,
    p_lease_seconds: input.leaseSeconds,
    p_reason: input.reason,
  });
  if (error) throw new Error(error.message || "device_lock_failed");
  const payload = (data ?? {}) as Record<string, unknown>;
  if (!readBoolean(payload.ok) || !readBoolean(payload.acquired)) {
    return { ok: false as const, reason: readString(payload.reason, "device_lock_held") };
  }
  return { ok: true as const, reason: "" };
}

export async function bindDeviceSessionLockToRequest(
  supabase: SupabaseLike,
  input: { deviceId: string; workerId: string; requestId: string; leaseSeconds: number },
) {
  const { data, error } = await supabase.rpc("auto_restart_bind_device_lock_to_request", {
    p_device_id: input.deviceId,
    p_worker_id: input.workerId,
    p_request_id: input.requestId,
    p_lease_seconds: input.leaseSeconds,
  });
  if (error) throw new Error(error.message || "device_lock_bind_failed");
  const payload = (data ?? {}) as Record<string, unknown>;
  if (!readBoolean(payload.ok) || !readBoolean(payload.bound)) {
    return { ok: false as const, reason: readString(payload.reason, "device_lock_bind_failed") };
  }
  return { ok: true as const, reason: "" };
}

export async function releaseDeviceSessionLock(
  supabase: SupabaseLike,
  input: { deviceId: string; workerId: string; requestId?: string | null },
) {
  const params: Record<string, unknown> = {
    p_device_id: input.deviceId,
    p_worker_id: input.workerId,
  };
  if (input.requestId) params.p_request_id = input.requestId;
  const { data, error } = await supabase.rpc("auto_restart_release_device_lock", params);
  if (error) throw new Error(error.message || "device_lock_release_failed");
  return (data ?? {}) as Record<string, unknown>;
}

export function pendingManualLockWorkerId(requestId: string) {
  return `pending-request:${requestId}`;
}

export function defaultDeviceLockLeaseSeconds(env: Record<string, string | undefined> = process.env) {
  return Math.min(3600, Math.max(60, Number(env.INSTAGRAM_AUTO_RESTART_DEVICE_LOCK_SECONDS || 900) || 900));
}
