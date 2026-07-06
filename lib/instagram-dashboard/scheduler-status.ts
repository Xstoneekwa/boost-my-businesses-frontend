/**
 * Scheduler status read-model.
 *
 * Derives an observability contract from canonical facts only:
 * - auto_restart_settings (id=global) — the single ON/OFF authority;
 * - auto_restart_tick_locks — real tick executions (enabled, non-manual ticks);
 * - auto_restart_decisions — per-account decisions written by the canonical tick;
 * - dispatcher worker heartbeat (worker_heartbeats projection passed by caller).
 *
 * This module never decides eligibility, never creates runs and never becomes
 * a second source of truth: every field is a projection of persisted facts.
 */

export type SchedulerEngineStatus = "running" | "degraded" | "unknown";
export type SchedulerBackendMode = "enabled" | "disabled_by_config";

export type SchedulerEngineHealthInput = {
  healthy: boolean;
  dispatcherWorkerId: string | null;
  lastSeenAt: string | null;
  reason?: string | null;
};

export type SchedulerRecentDecision = {
  account_id: string | null;
  username: string | null;
  action: string;
  decision: string;
  reason: string;
  created_at: string;
};

export type SchedulerStatus = {
  read_only: true;
  engine_status: SchedulerEngineStatus;
  engine_worker_id: string | null;
  engine_last_seen_at: string | null;
  backend_mode: SchedulerBackendMode;
  tick_interval_seconds: number | null;
  last_tick_at: string | null;
  last_success_at: string | null;
  last_error: { at: string; reason: string } | null;
  decisions_window_hours: number;
  examined_count: number;
  enqueued_count: number;
  blocked_count: number;
  recent_decisions: SchedulerRecentDecision[];
  settings_updated_at: string | null;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  gte: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => Promise<QueryResult>;
  limit: (...args: unknown[]) => Promise<QueryResult>;
};

export type SchedulerStatusSupabase = {
  from: (table: string) => unknown;
};

function query(supabase: SchedulerStatusSupabase, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readBooleanStrict(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

/**
 * Projects the dispatcher heartbeat health (canonical worker_heartbeats
 * projection) into the three-state engine badge. No local liveness rule is
 * introduced: `healthy` already applies the canonical max-age policy.
 */
export function projectSchedulerEngineStatus(health: SchedulerEngineHealthInput | null): SchedulerEngineStatus {
  if (!health) return "unknown";
  if (!health.dispatcherWorkerId) return "unknown";
  if (health.reason === "dispatcher_health_read_failed") return "unknown";
  if (health.healthy) return "running";
  if (health.lastSeenAt) return "degraded";
  return "unknown";
}

export function projectSchedulerBackendMode(settingsRow: Record<string, unknown> | null): SchedulerBackendMode {
  return readBooleanStrict(settingsRow?.auto_restart_enabled, false) ? "enabled" : "disabled_by_config";
}

async function loadSettingsRow(supabase: SchedulerStatusSupabase) {
  const result = await query(supabase, "auto_restart_settings")
    .select("auto_restart_enabled,check_every_minutes,updated_at")
    .eq("id", "global")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "auto_restart_settings_unavailable");
  return (result.data ?? null) as Record<string, unknown> | null;
}

async function loadRecentTickLocks(supabase: SchedulerStatusSupabase) {
  const result = await query(supabase, "auto_restart_tick_locks")
    .select("idempotency_key,worker_id,tick_started_at,tick_completed_at,status,metadata_safe")
    .order("tick_started_at", { ascending: false })
    .limit(20);
  if (result.error) throw new Error(result.error.message || "auto_restart_tick_locks_unavailable");
  return readRows(result.data);
}

async function loadRecentDecisions(supabase: SchedulerStatusSupabase, sinceIso: string) {
  const result = await query(supabase, "auto_restart_decisions")
    .select("account_id,action,decision,reason,created_at,metadata_safe")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(200);
  if (result.error) throw new Error(result.error.message || "auto_restart_decisions_unavailable");
  return readRows(result.data);
}

async function loadUsernames(supabase: SchedulerStatusSupabase, accountIds: string[]) {
  if (!accountIds.length) return new Map<string, string>();
  const result = await query(supabase, "ig_accounts")
    .select("id,username")
    .in("id", accountIds)
    .limit(accountIds.length);
  const map = new Map<string, string>();
  if (result.error) return map;
  for (const row of readRows(result.data)) {
    const id = readString(row.id);
    const username = readString(row.username);
    if (id && username) map.set(id, username);
  }
  return map;
}

export function summarizeTickLocks(locks: Record<string, unknown>[]) {
  let lastTickAt: string | null = null;
  let lastSuccessAt: string | null = null;
  let lastError: { at: string; reason: string } | null = null;
  for (const lock of locks) {
    const startedAt = readString(lock.tick_started_at) || null;
    const completedAt = readString(lock.tick_completed_at) || null;
    const status = readString(lock.status).toLowerCase();
    if (startedAt && (!lastTickAt || startedAt > lastTickAt)) lastTickAt = startedAt;
    if (status === "completed" && completedAt && (!lastSuccessAt || completedAt > lastSuccessAt)) {
      lastSuccessAt = completedAt;
    }
    if (status === "failed") {
      const at = completedAt || startedAt;
      if (at && (!lastError || at > lastError.at)) {
        // The tick engine persists a redacted failure reason in the lock
        // metadata when it finalizes a failed tick; fall back to the stable
        // generic reason for legacy rows.
        const metadata = lock.metadata_safe && typeof lock.metadata_safe === "object" && !Array.isArray(lock.metadata_safe)
          ? (lock.metadata_safe as Record<string, unknown>)
          : {};
        lastError = { at, reason: readString(metadata.failure_reason) || "tick_failed" };
      }
    }
  }
  return { lastTickAt, lastSuccessAt, lastError };
}

export function summarizeDecisions(decisions: Record<string, unknown>[]) {
  const examinedAccounts = new Set<string>();
  let enqueuedCount = 0;
  let blockedCount = 0;
  for (const row of decisions) {
    const accountId = readString(row.account_id);
    const decision = readString(row.decision).toLowerCase();
    if (!accountId) continue;
    examinedAccounts.add(accountId);
    if (decision === "enqueued") enqueuedCount += 1;
    else if (decision === "blocked") blockedCount += 1;
  }
  return {
    examinedCount: examinedAccounts.size,
    enqueuedCount,
    blockedCount,
  };
}

export const SCHEDULER_DECISIONS_WINDOW_HOURS = 24;
export const SCHEDULER_RECENT_DECISIONS_LIMIT = 20;

export async function buildSchedulerStatus(
  supabase: SchedulerStatusSupabase,
  options: {
    engineHealth: SchedulerEngineHealthInput | null;
    now?: Date;
    decisionsWindowHours?: number;
    recentLimit?: number;
  },
): Promise<SchedulerStatus> {
  const now = options.now ?? new Date();
  const windowHours = options.decisionsWindowHours ?? SCHEDULER_DECISIONS_WINDOW_HOURS;
  const recentLimit = options.recentLimit ?? SCHEDULER_RECENT_DECISIONS_LIMIT;
  const sinceIso = new Date(now.getTime() - windowHours * 3_600_000).toISOString();

  const settingsRow = await loadSettingsRow(supabase);
  const [tickLocks, decisions] = await Promise.all([
    loadRecentTickLocks(supabase),
    loadRecentDecisions(supabase, sinceIso),
  ]);

  const tickSummary = summarizeTickLocks(tickLocks);
  const decisionSummary = summarizeDecisions(decisions);

  const accountIds = Array.from(
    new Set(decisions.map((row) => readString(row.account_id)).filter(Boolean)),
  );
  const usernames = await loadUsernames(supabase, accountIds);

  const recentDecisions: SchedulerRecentDecision[] = decisions.slice(0, recentLimit).map((row) => {
    const accountId = readString(row.account_id) || null;
    const metadata = row.metadata_safe && typeof row.metadata_safe === "object" && !Array.isArray(row.metadata_safe)
      ? (row.metadata_safe as Record<string, unknown>)
      : {};
    const username = (accountId ? usernames.get(accountId) : null) || readString(metadata.username) || null;
    return {
      account_id: accountId,
      username,
      action: readString(row.action),
      decision: readString(row.decision),
      reason: readString(row.reason),
      created_at: readString(row.created_at),
    };
  });

  const checkEveryMinutes = readNumber(settingsRow?.check_every_minutes, 0);

  return {
    read_only: true,
    engine_status: projectSchedulerEngineStatus(options.engineHealth),
    engine_worker_id: options.engineHealth?.dispatcherWorkerId ?? null,
    engine_last_seen_at: options.engineHealth?.lastSeenAt ?? null,
    backend_mode: projectSchedulerBackendMode(settingsRow),
    tick_interval_seconds: checkEveryMinutes > 0 ? Math.round(checkEveryMinutes * 60) : null,
    last_tick_at: tickSummary.lastTickAt,
    last_success_at: tickSummary.lastSuccessAt,
    last_error: tickSummary.lastError,
    decisions_window_hours: windowHours,
    examined_count: decisionSummary.examinedCount,
    enqueued_count: decisionSummary.enqueuedCount,
    blocked_count: decisionSummary.blockedCount,
    recent_decisions: recentDecisions,
    settings_updated_at: readString(settingsRow?.updated_at) || null,
  };
}
