type SupabaseLike = {
  from: (table: string) => unknown;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
};

export const DISPATCHER_TRUST_FAILURE = "untrusted_or_stale_dispatcher";
export const MANUAL_RESTART_AUDIT_ACTOR = "botapp-manual-restart";

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function runControlDispatcherHealthMaxAgeSeconds(env: Record<string, string | undefined> = process.env) {
  const raw =
    readString(env.INSTAGRAM_RUN_CONTROL_DISPATCHER_HEALTH_MAX_AGE_SECONDS)
    || readString(env.RUN_CONTROL_DISPATCHER_HEALTH_MAX_AGE_SECONDS)
    || "90";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(15, parsed) : 90;
}

function runControlHeartbeatAgeSeconds(lastSeenAt: string | null) {
  if (!lastSeenAt) return null;
  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return null;
  return Math.max(0, Math.round((Date.now() - lastSeenMs) / 1000));
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

export function isRunDispatcherWorkerId(workerId: string) {
  return workerId.trim().startsWith("run-dispatcher:");
}

export function assertTrustedDispatcherWorkerId(workerId: string) {
  const normalized = workerId.trim();
  if (!normalized || normalized === "auto-restart-tick") {
    return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
  }
  if (normalized === MANUAL_RESTART_AUDIT_ACTOR) {
    return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
  }
  if (!isRunDispatcherWorkerId(normalized)) {
    return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
  }
  return { ok: true as const, reason: "" };
}

function dispatcherHostFromWorkerId(workerId: string) {
  const normalized = workerId.trim();
  if (!normalized.startsWith("run-dispatcher:")) return "";
  return normalized.slice("run-dispatcher:".length).trim().toLowerCase();
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Primary authority: phone_devices.host_machine + worker_heartbeats.host_machine alignment. */
export function phoneDeviceAuthorizedForDispatcher(
  phoneDevice: Record<string, unknown>,
  dispatcherHost: string,
  heartbeatHostMachine: string,
) {
  const normalizedDispatcherHost = dispatcherHost.trim().toLowerCase();
  if (!normalizedDispatcherHost) {
    return false;
  }

  const deviceHost = readString(phoneDevice.host_machine).toLowerCase();
  if (!deviceHost || deviceHost !== normalizedDispatcherHost) {
    return false;
  }

  const heartbeatHost = readString(heartbeatHostMachine).toLowerCase();
  if (heartbeatHost && heartbeatHost !== normalizedDispatcherHost) {
    return false;
  }

  const metadata = readRecord(phoneDevice.metadata);
  const metadataHost = readString(metadata.dispatcher_host).toLowerCase();
  if (metadataHost && metadataHost !== normalizedDispatcherHost) {
    return false;
  }

  return true;
}

export async function assertTrustedDispatcherIdentity(
  supabase: SupabaseLike,
  workerId: string,
  options: {
    deviceIds?: string[];
    maxAgeSeconds?: number;
    allowBotappManual?: boolean;
  } = {},
) {
  const prefixCheck = assertTrustedDispatcherWorkerId(workerId);
  if (!prefixCheck.ok) return prefixCheck;

  const maxAgeSeconds = options.maxAgeSeconds ?? runControlDispatcherHealthMaxAgeSeconds();
  const heartbeatResult = await query(supabase, "worker_heartbeats")
    .select("worker_id,status,last_seen_at,host_machine,metadata")
    .eq("worker_id", workerId)
    .maybeSingle();
  if (heartbeatResult.error || !heartbeatResult.data) {
    return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
  }

  const row = heartbeatResult.data as Record<string, unknown>;
  const status = readString(row.status, "unknown");
  const lastSeenAt = readString(row.last_seen_at);
  const ageSeconds = runControlHeartbeatAgeSeconds(lastSeenAt);
  const statusHealthy = ["starting", "idle", "running"].includes(status);
  if (!statusHealthy || ageSeconds == null || ageSeconds > maxAgeSeconds) {
    return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
  }

  const deviceIds = (options.deviceIds ?? []).filter(Boolean);
  if (!deviceIds.length) {
    return { ok: true as const, reason: "" };
  }

  const dispatcherHost = dispatcherHostFromWorkerId(workerId);
  if (!dispatcherHost) {
    return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
  }

  const heartbeatHostMachine = readString(row.host_machine);
  const phoneDevicesResult = await query(supabase, "phone_devices")
    .select("id,host_machine,status,metadata")
    .in("id", deviceIds)
    .limit(Math.max(1, deviceIds.length));
  if (phoneDevicesResult.error) {
    return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
  }
  const phoneRows = Array.isArray(phoneDevicesResult.data)
    ? phoneDevicesResult.data as Record<string, unknown>[]
    : [];
  if (phoneRows.length !== deviceIds.length) {
    return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
  }

  for (const phoneDevice of phoneRows) {
    if (!phoneDeviceAuthorizedForDispatcher(phoneDevice, dispatcherHost, heartbeatHostMachine)) {
      return { ok: false as const, reason: DISPATCHER_TRUST_FAILURE };
    }
  }

  return { ok: true as const, reason: "" };
}

export async function resolveTrustedDispatcherWorkerForPhoneDevice(
  supabase: SupabaseLike,
  deviceId: string,
  options: { maxAgeSeconds?: number } = {},
) {
  const normalizedDeviceId = deviceId.trim();
  if (!normalizedDeviceId) {
    return {
      ok: false as const,
      reason: DISPATCHER_TRUST_FAILURE,
      workerId: "",
      verifiedAt: null as string | null,
    };
  }

  const phoneDevicesResult = await query(supabase, "phone_devices")
    .select("id,host_machine,status,metadata")
    .in("id", [normalizedDeviceId])
    .limit(1);
  const phoneRows = Array.isArray(phoneDevicesResult.data)
    ? phoneDevicesResult.data as Record<string, unknown>[]
    : phoneDevicesResult.data
      ? [phoneDevicesResult.data as Record<string, unknown>]
      : [];
  if (phoneDevicesResult.error || phoneRows.length !== 1) {
    return {
      ok: false as const,
      reason: DISPATCHER_TRUST_FAILURE,
      workerId: "",
      verifiedAt: null as string | null,
    };
  }

  const phoneDevice = phoneRows[0];
  const hostMachine = readString(phoneDevice.host_machine).toLowerCase();
  if (!hostMachine) {
    return {
      ok: false as const,
      reason: DISPATCHER_TRUST_FAILURE,
      workerId: "",
      verifiedAt: null as string | null,
    };
  }

  const workerId = `run-dispatcher:${hostMachine}`;
  const trust = await assertTrustedDispatcherIdentity(supabase, workerId, {
    deviceIds: [normalizedDeviceId],
    maxAgeSeconds: options.maxAgeSeconds,
  });
  if (!trust.ok) {
    return {
      ok: false as const,
      reason: trust.reason,
      workerId,
      verifiedAt: null as string | null,
    };
  }

  return {
    ok: true as const,
    reason: "",
    workerId,
    verifiedAt: new Date().toISOString(),
  };
}
