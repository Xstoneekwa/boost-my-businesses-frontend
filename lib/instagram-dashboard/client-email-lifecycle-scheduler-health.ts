import { CLIENT_EMAIL_LIFECYCLE_CRON_WORKER_ID } from "./client-email-lifecycle-cron.ts";
import type { ClientEmailSupabase } from "./client-email-supabase.ts";

export const CLIENT_EMAIL_LIFECYCLE_CRON_PATH = "/api/cron/client-email-lifecycle" as const;
export const CLIENT_EMAIL_LIFECYCLE_CRON_SCHEDULE = "*/15 * * * *" as const;
export const CLIENT_EMAIL_LIFECYCLE_NATIVE_CRON_STALE_MS = 30 * 60 * 1000;

export type ClientEmailLifecycleSchedulerStatus =
  | "awaiting_first_native_tick"
  | "healthy"
  | "stale"
  | "misconfigured";

export type ClientEmailLifecycleCronInvoker = "vercel_native" | "manual";

export type ClientEmailLifecycleSchedulerHealth = {
  status: ClientEmailLifecycleSchedulerStatus;
  schedulerConnected: boolean;
  cronSecretConfigured: boolean;
  lastNativeSuccessAt: string | null;
  nativeTickCount: number;
  lastInvoker: ClientEmailLifecycleCronInvoker | null;
  reason: string;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

export function detectClientEmailLifecycleCronInvoker(headers: Headers): ClientEmailLifecycleCronInvoker {
  const vercelCron = headers.get("x-vercel-cron")?.trim() ?? "";
  if (vercelCron === "1") return "vercel_native";
  return "manual";
}

export function projectClientEmailLifecycleSchedulerHealth(input: {
  env: Record<string, string | undefined>;
  heartbeatMetadata?: Record<string, unknown> | null;
  now?: Date;
}): ClientEmailLifecycleSchedulerHealth {
  const now = input.now ?? new Date();
  const cronSecretConfigured = Boolean(input.env.CRON_SECRET?.trim());
  const metadata = input.heartbeatMetadata ?? null;
  const lastNativeSuccessAt = readString(metadata?.last_native_success_at, "") || null;
  const nativeTickCount = readNumber(metadata?.native_tick_count, 0);
  const lastInvokerRaw = readString(metadata?.last_invoker, "");
  const lastInvoker = lastInvokerRaw === "vercel_native" || lastInvokerRaw === "manual"
    ? lastInvokerRaw
    : null;

  if (!cronSecretConfigured) {
    return {
      status: "misconfigured",
      schedulerConnected: false,
      cronSecretConfigured: false,
      lastNativeSuccessAt,
      nativeTickCount,
      lastInvoker,
      reason: "CRON_SECRET is not configured for the lifecycle cron route.",
    };
  }

  if (nativeTickCount === 0 || !lastNativeSuccessAt) {
    return {
      status: "awaiting_first_native_tick",
      schedulerConnected: false,
      cronSecretConfigured: true,
      lastNativeSuccessAt,
      nativeTickCount,
      lastInvoker,
      reason: "Lifecycle cron is configured, but no authenticated native Vercel tick has succeeded yet.",
    };
  }

  const lastNativeMs = new Date(lastNativeSuccessAt).getTime();
  if (Number.isNaN(lastNativeMs)) {
    return {
      status: "misconfigured",
      schedulerConnected: false,
      cronSecretConfigured: true,
      lastNativeSuccessAt,
      nativeTickCount,
      lastInvoker,
      reason: "Native scheduler heartbeat timestamp is invalid.",
    };
  }

  const ageMs = now.getTime() - lastNativeMs;
  if (ageMs > CLIENT_EMAIL_LIFECYCLE_NATIVE_CRON_STALE_MS) {
    return {
      status: "stale",
      schedulerConnected: false,
      cronSecretConfigured: true,
      lastNativeSuccessAt,
      nativeTickCount,
      lastInvoker,
      reason: "No successful native Vercel lifecycle cron tick in the last 30 minutes.",
    };
  }

  return {
    status: "healthy",
    schedulerConnected: true,
    cronSecretConfigured: true,
    lastNativeSuccessAt,
    nativeTickCount,
    lastInvoker,
    reason: "Native Vercel lifecycle cron tick succeeded recently.",
  };
}

export async function loadClientEmailLifecycleSchedulerHealth(
  supabase: ClientEmailSupabase,
  input: {
    env?: Record<string, string | undefined>;
    now?: Date;
  } = {},
): Promise<ClientEmailLifecycleSchedulerHealth> {
  const env = input.env ?? process.env;
  const { data } = await supabase
    .from("worker_heartbeats")
    .select("metadata")
    .eq("worker_id", CLIENT_EMAIL_LIFECYCLE_CRON_WORKER_ID)
    .maybeSingle();

  return projectClientEmailLifecycleSchedulerHealth({
    env,
    heartbeatMetadata: (data as { metadata?: Record<string, unknown> } | null)?.metadata ?? null,
    now: input.now,
  });
}

export function buildClientEmailLifecycleCronHeartbeatMetadata(input: {
  existingMetadata?: Record<string, unknown> | null;
  ok: boolean;
  invoker: ClientEmailLifecycleCronInvoker;
  now: Date;
  consecutiveFailures: number;
  incidentSignals: string[];
}) {
  const existing = input.existingMetadata ?? {};
  const nowIso = input.now.toISOString();
  const previousNativeSuccessAt = readString(existing.last_native_success_at, "") || null;
  const previousNativeTickCount = readNumber(existing.native_tick_count, 0);
  const nativeTickCount = input.invoker === "vercel_native" && input.ok
    ? previousNativeTickCount + 1
    : previousNativeTickCount;
  const lastNativeSuccessAt = input.invoker === "vercel_native" && input.ok
    ? nowIso
    : previousNativeSuccessAt;

  return {
    consecutive_failures: input.consecutiveFailures,
    incident_signals: input.incidentSignals,
    last_ok: input.ok,
    last_invoker: input.invoker,
    last_tick_at: nowIso,
    last_native_success_at: lastNativeSuccessAt,
    native_tick_count: nativeTickCount,
    last_manual_tick_at: input.invoker === "manual" ? nowIso : readString(existing.last_manual_tick_at, "") || null,
  };
}
