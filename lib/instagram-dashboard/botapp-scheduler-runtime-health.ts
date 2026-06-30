export const BOTAPP_SCHEDULER_RUNTIME_WORKER_PREFIX = "botapp-scheduler-runtime" as const;
/** Three missed 30s heartbeats before treating BotApp scheduler runtime as stale. */
export const BOTAPP_SCHEDULER_RUNTIME_STALE_MS = 90 * 1000;

export type BotAppSchedulerRuntimeStatus =
  | "active"
  | "awaiting_botapp"
  | "stale"
  | "unavailable"
  | "stopping"
  | "misconfigured";

export type BotAppSchedulerRuntimeHealth = {
  status: BotAppSchedulerRuntimeStatus;
  schedulerConnected: boolean;
  workerId: string | null;
  runtimeHost: string | null;
  lastSeenAt: string | null;
  heartbeatAgeSeconds: number | null;
  voluntaryShutdown: boolean;
  dispatcherObservedStatus: string | null;
  reason: string;
};

type SupabaseLike = {
  from: (table: string) => unknown;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  like: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => Promise<QueryResult>;
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

export function buildBotAppSchedulerRuntimeWorkerId(runtimeHost: string) {
  const normalized = runtimeHost.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 80);
  return `${BOTAPP_SCHEDULER_RUNTIME_WORKER_PREFIX}:${normalized || "unknown-host"}`;
}

export function parseBotAppSchedulerRuntimeWorkerId(workerId: string) {
  const prefix = `${BOTAPP_SCHEDULER_RUNTIME_WORKER_PREFIX}:`;
  if (!workerId.startsWith(prefix)) return null;
  return workerId.slice(prefix.length) || null;
}

export function projectBotAppSchedulerRuntimeHealth(input: {
  heartbeat?: {
    worker_id?: unknown;
    status?: unknown;
    last_seen_at?: unknown;
    metadata?: Record<string, unknown> | null;
  } | null;
  now?: Date;
}): BotAppSchedulerRuntimeHealth {
  const now = input.now ?? new Date();
  const heartbeat = input.heartbeat ?? null;
  const workerId = readString(heartbeat?.worker_id, "") || null;
  const metadata = heartbeat?.metadata ?? null;
  const runtimeHost = readString(metadata?.runtime_host, "") || (workerId ? parseBotAppSchedulerRuntimeWorkerId(workerId) : null);
  const lastSeenAt = readString(heartbeat?.last_seen_at, "") || null;
  const status = readString(heartbeat?.status, "").toLowerCase();
  const voluntaryShutdown = readBoolean(metadata?.voluntary_shutdown, false);
  const dispatcherObservedStatus = readString(metadata?.dispatcher_observed_status, "") || null;
  const schedulerAvailable = readBoolean(metadata?.scheduler_available, status === "idle" || status === "running");

  if (!workerId || !lastSeenAt) {
    return {
      status: "awaiting_botapp",
      schedulerConnected: false,
      workerId,
      runtimeHost,
      lastSeenAt,
      heartbeatAgeSeconds: null,
      voluntaryShutdown,
      dispatcherObservedStatus,
      reason: "No BotApp scheduler runtime heartbeat has been observed yet.",
    };
  }

  const lastSeenMs = Date.parse(lastSeenAt);
  const heartbeatAgeSeconds = Number.isFinite(lastSeenMs)
    ? Math.max(0, Math.round((now.getTime() - lastSeenMs) / 1000))
    : null;

  if (status === "stopping" || status === "offline" || voluntaryShutdown) {
    return {
      status: "unavailable",
      schedulerConnected: false,
      workerId,
      runtimeHost,
      lastSeenAt,
      heartbeatAgeSeconds,
      voluntaryShutdown,
      dispatcherObservedStatus,
      reason: voluntaryShutdown
        ? "BotApp scheduler runtime was closed voluntarily."
        : "BotApp scheduler runtime is stopping or offline.",
    };
  }

  if (!Number.isFinite(lastSeenMs) || heartbeatAgeSeconds === null) {
    return {
      status: "misconfigured",
      schedulerConnected: false,
      workerId,
      runtimeHost,
      lastSeenAt,
      heartbeatAgeSeconds,
      voluntaryShutdown,
      dispatcherObservedStatus,
      reason: "BotApp scheduler runtime heartbeat timestamp is invalid.",
    };
  }

  const ageMs = now.getTime() - lastSeenMs;
  if (ageMs > BOTAPP_SCHEDULER_RUNTIME_STALE_MS) {
    return {
      status: "stale",
      schedulerConnected: false,
      workerId,
      runtimeHost,
      lastSeenAt,
      heartbeatAgeSeconds,
      voluntaryShutdown,
      dispatcherObservedStatus,
      reason: "BotApp scheduler runtime heartbeat is stale.",
    };
  }

  if (!schedulerAvailable || !["idle", "running"].includes(status)) {
    return {
      status: "unavailable",
      schedulerConnected: false,
      workerId,
      runtimeHost,
      lastSeenAt,
      heartbeatAgeSeconds,
      voluntaryShutdown,
      dispatcherObservedStatus,
      reason: "BotApp scheduler runtime is not marked available.",
    };
  }

  return {
    status: "active",
    schedulerConnected: true,
    workerId,
    runtimeHost,
    lastSeenAt,
    heartbeatAgeSeconds,
    voluntaryShutdown: false,
    dispatcherObservedStatus,
    reason: "BotApp scheduler runtime is active.",
  };
}

export async function loadBotAppSchedulerRuntimeHealth(
  supabase: SupabaseLike,
  input: {
    runtimeHost?: string | null;
    now?: Date;
  } = {},
): Promise<BotAppSchedulerRuntimeHealth> {
  const configuredHost = readString(input.runtimeHost ?? process.env.INSTAGRAM_BOTAPP_SCHEDULER_RUNTIME_HOST, "");
  if (configuredHost) {
    const workerId = buildBotAppSchedulerRuntimeWorkerId(configuredHost);
    const result = await query(supabase, "worker_heartbeats")
      .select("worker_id,status,last_seen_at,metadata")
      .eq("worker_id", workerId)
      .limit(1) as QueryResult;
    const row = Array.isArray(result.data) ? (result.data[0] as Record<string, unknown> | undefined) : undefined;
    return projectBotAppSchedulerRuntimeHealth({
      heartbeat: row as never,
      now: input.now,
    });
  }

  const result = await query(supabase, "worker_heartbeats")
    .select("worker_id,status,last_seen_at,metadata")
    .like("worker_id", `${BOTAPP_SCHEDULER_RUNTIME_WORKER_PREFIX}:%`)
    .order("last_seen_at", { ascending: false })
    .limit(1) as QueryResult;
  const row = Array.isArray(result.data) ? (result.data[0] as Record<string, unknown> | undefined) : undefined;
  return projectBotAppSchedulerRuntimeHealth({
    heartbeat: row as never,
    now: input.now,
  });
}

export type BotAppSchedulerRuntimeHeartbeatPayload = {
  worker_id: string;
  status: "idle" | "running" | "stopping" | "offline";
  runtime_host: string;
  scheduler_available: boolean;
  voluntary_shutdown: boolean;
  dispatcher_observed_status?: string | null;
  relay_authenticated?: boolean;
};

export function normalizeBotAppSchedulerRuntimeHeartbeatPayload(body: Record<string, unknown>) {
  const runtimeHost = readString(body.runtime_host, "");
  const workerId = readString(body.worker_id, "") || (runtimeHost ? buildBotAppSchedulerRuntimeWorkerId(runtimeHost) : "");
  const statusRaw = readString(body.status, "idle").toLowerCase();
  const status = statusRaw === "running" || statusRaw === "stopping" || statusRaw === "offline" ? statusRaw : "idle";
  return {
    worker_id: workerId,
    status,
    runtime_host: runtimeHost || parseBotAppSchedulerRuntimeWorkerId(workerId) || "unknown-host",
    scheduler_available: readBoolean(body.scheduler_available, status === "idle" || status === "running"),
    voluntary_shutdown: readBoolean(body.voluntary_shutdown, status === "stopping" || status === "offline"),
    dispatcher_observed_status: readString(body.dispatcher_observed_status, "") || null,
    relay_authenticated: readBoolean(body.relay_authenticated, false),
  } satisfies BotAppSchedulerRuntimeHeartbeatPayload;
}
