type SupabaseLike = {
  from: (table: string) => unknown;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => Promise<QueryResult>;
};

export type DispatcherSchedulerRuntimeStatus =
  | "active"
  | "unconfigured"
  | "unavailable"
  | "stale"
  | "misconfigured";

export type DispatcherSchedulerRuntimeHealth = {
  dispatcherConnected: boolean;
  status: DispatcherSchedulerRuntimeStatus;
  workerId: string | null;
  lastSeenAt: string | null;
  heartbeatAgeSeconds: number | null;
  processId: string | null;
  reason: string;
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

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" && !Array.isArray(first)
      ? first as Record<string, unknown>
      : null;
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

export function projectDispatcherSchedulerRuntimeHealth(input: {
  workerId?: string | null;
  heartbeat?: Record<string, unknown> | null;
  now?: Date;
  maxAgeSeconds?: number;
}): DispatcherSchedulerRuntimeHealth {
  const workerId = readString(input.workerId) || null;
  if (!workerId) {
    return {
      dispatcherConnected: false,
      status: "unconfigured",
      workerId: null,
      lastSeenAt: null,
      heartbeatAgeSeconds: null,
      processId: null,
      reason: "Run dispatcher worker id is not configured.",
    };
  }

  const heartbeat = input.heartbeat ?? null;
  if (!heartbeat) {
    return {
      dispatcherConnected: false,
      status: "unavailable",
      workerId,
      lastSeenAt: null,
      heartbeatAgeSeconds: null,
      processId: null,
      reason: "Run dispatcher heartbeat is unavailable.",
    };
  }

  const now = input.now ?? new Date();
  const lastSeenAt = readString(heartbeat.last_seen_at) || null;
  const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : Number.NaN;
  const heartbeatAgeSeconds = Number.isFinite(lastSeenMs)
    ? Math.max(0, Math.round((now.getTime() - lastSeenMs) / 1000))
    : null;
  const processId = readString(heartbeat.process_id) || null;
  const status = readString(heartbeat.status).toLowerCase();
  const metadata = readRecord(heartbeat.metadata);
  const component = readString(metadata.component).toLowerCase();
  const launchEnabled = readBoolean(metadata.launch_enabled, false);
  const healthOnly = readBoolean(metadata.health_only, true);

  if (!lastSeenAt || heartbeatAgeSeconds === null) {
    return {
      dispatcherConnected: false,
      status: "misconfigured",
      workerId,
      lastSeenAt,
      heartbeatAgeSeconds,
      processId,
      reason: "Run dispatcher heartbeat timestamp is invalid.",
    };
  }

  if (heartbeatAgeSeconds > (input.maxAgeSeconds ?? 60)) {
    return {
      dispatcherConnected: false,
      status: "stale",
      workerId,
      lastSeenAt,
      heartbeatAgeSeconds,
      processId,
      reason: "Run dispatcher heartbeat is stale.",
    };
  }

  const processRunning = Boolean(processId)
    && component === "run_control_dispatcher"
    && launchEnabled
    && !healthOnly
    && ["idle", "running"].includes(status);
  if (!processRunning) {
    return {
      dispatcherConnected: false,
      status: "unavailable",
      workerId,
      lastSeenAt,
      heartbeatAgeSeconds,
      processId,
      reason: "Run dispatcher is not launch-capable.",
    };
  }

  return {
    dispatcherConnected: true,
    status: "active",
    workerId,
    lastSeenAt,
    heartbeatAgeSeconds,
    processId,
    reason: "Run dispatcher is active.",
  };
}

export async function loadDispatcherSchedulerRuntimeHealth(
  supabase: SupabaseLike,
  input: {
    now?: Date;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const {
    runControlDispatcherHealthMaxAgeSeconds,
    runControlDispatcherWorkerId,
  } = await import("./run-control.ts");
  const workerId = runControlDispatcherWorkerId(input.env);
  if (!workerId) return projectDispatcherSchedulerRuntimeHealth({ workerId: null });

  const result = await query(supabase, "worker_heartbeats")
    .select("worker_id,status,last_seen_at,process_id,metadata")
    .eq("worker_id", workerId)
    .limit(1);
  if (result.error) throw new Error(result.error.message || "dispatcher_heartbeat_unavailable");

  return projectDispatcherSchedulerRuntimeHealth({
    workerId,
    heartbeat: readRow(result.data),
    now: input.now,
    maxAgeSeconds: runControlDispatcherHealthMaxAgeSeconds(input.env),
  });
}
