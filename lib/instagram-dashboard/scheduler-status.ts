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

import { normalizeSchedulerReason, type SchedulerReasonKind } from "./scheduler-reasons.ts";
import {
  dailySlotLabel,
  extractDailySlot,
  projectDailyWindows,
  SCHEDULE_PROJECTION_HORIZON_HOURS,
} from "./schedule-recurrence.ts";
import {
  classifySessionTransitionPhase,
  deriveSessionTransitionTimestamps,
} from "./session-transition-buffer.ts";
import { buildDailySchedulerPipeline, type DailySchedulerPipeline } from "./daily-scheduler-pipeline.ts";

export type SchedulerEngineStatus = "running" | "degraded" | "unknown";
export type SchedulerBackendMode = "enabled" | "disabled_by_config";

export type SchedulerEngineHealthInput = {
  healthy: boolean;
  dispatcherWorkerId: string | null;
  lastSeenAt: string | null;
  reason?: string | null;
};

/**
 * CP1 — every projected decision carries a stable `reason_code` + kind, and
 * global configuration events (auto_restart_settings_updated) are explicitly
 * typed so no consumer ever renders them as an "unknown account".
 */
export type SchedulerRecentDecision = {
  account_id: string | null;
  username: string | null;
  action: string;
  decision: string;
  reason: string;
  reason_code: string;
  reason_kind: SchedulerReasonKind;
  event: "account_decision" | "scheduler_config";
  config_enabled: boolean | null;
  created_at: string;
};

/** CP0/CP1 — projection of the daily engine configuration (schedule-session cron). */
export type SchedulerDailyEngine = {
  technical_enabled: boolean;
  dry_run: boolean;
  state: "technical_disabled" | "dry_run" | "scheduler_disabled" | "active";
};

/** CP3 — BotApp scheduler runtime gate used by schedule-session cron. */
export type SchedulerDailyRuntimeGate = {
  scheduler_connected: boolean;
  status: string;
  heartbeat_age_seconds: number | null;
  reason: string;
};

/**
 * CP2 — derived daily occurrence of a `scheduled` account inside the 48h
 * horizon. Pure projection of the durable Schedule (single open assignment
 * row): nothing here is a second source of truth and nothing creates runs.
 */
export type SchedulerUpcomingWindow = {
  account_id: string;
  username: string | null;
  device_id: string | null;
  device_name: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  /** Local slot label, e.g. "06:00–12:00". */
  local_slot: string;
  /** True while now is inside this occurrence. */
  is_open: boolean;
  /** True when the stored dated window already matches this occurrence. */
  materialized: boolean;
  /** True when the stored dated window has expired and awaits roll-forward. */
  stored_window_expired: boolean;
  /** CP4 — absolute business cutoff (session_end - 10m). */
  business_action_deadline: string | null;
  /** CP4 — absolute preflight window start (session_start - 10m). */
  preflight_start: string | null;
  /** CP4 — derived phase label for operator read-model. */
  transition_phase: string | null;
  /** CP4 — English operator label when buffer/preflight is active. */
  transition_operator_label: string | null;
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
  daily_engine: SchedulerDailyEngine | null;
  daily_runtime_gate: SchedulerDailyRuntimeGate | null;
  windows_horizon_hours: number;
  upcoming_windows: SchedulerUpcomingWindow[];
  daily_scheduler_pipeline: DailySchedulerPipeline | null;
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

async function loadOpenScheduledAssignments(supabase: SchedulerStatusSupabase) {
  const result = await query(supabase, "account_assignments")
    .select("id,account_id,device_id,starts_at,ends_at,status,schedule_mode,assignment_type")
    .in("status", ["reserved", "active"])
    .eq("schedule_mode", "scheduled")
    .order("starts_at", { ascending: true })
    .limit(50);
  if (result.error) throw new Error(result.error.message || "account_assignments_unavailable");
  return readRows(result.data).filter((row) => readString(row.assignment_type, "full_cycle") === "full_cycle");
}

async function loadDeviceNames(supabase: SchedulerStatusSupabase, deviceIds: string[]) {
  const map = new Map<string, { name: string | null; timezone: string | null }>();
  if (!deviceIds.length) return map;
  const result = await query(supabase, "phone_devices")
    .select("id,name,timezone")
    .in("id", deviceIds)
    .limit(deviceIds.length);
  if (result.error) return map;
  for (const row of readRows(result.data)) {
    const id = readString(row.id);
    if (!id) continue;
    map.set(id, {
      name: readString(row.name) || null,
      timezone: readString(row.timezone) || null,
    });
  }
  return map;
}

/**
 * CP2 — derives the 48h projection from the open `scheduled` assignments.
 * manual_only rows are excluded upstream (hard exclusion) and a stored window
 * that cannot express a daily slot is skipped rather than invented.
 */
export function projectUpcomingWindows(
  assignments: Record<string, unknown>[],
  usernames: Map<string, string>,
  devices: Map<string, { name: string | null; timezone: string | null }>,
  now: Date,
  horizonHours = SCHEDULE_PROJECTION_HORIZON_HOURS,
): SchedulerUpcomingWindow[] {
  const windows: SchedulerUpcomingWindow[] = [];
  for (const row of assignments) {
    if (readString(row.schedule_mode, "scheduled") !== "scheduled") continue;
    const accountId = readString(row.account_id);
    const startsAt = readString(row.starts_at);
    const endsAt = readString(row.ends_at);
    if (!accountId || !startsAt || !endsAt) continue;

    const deviceId = readString(row.device_id) || null;
    const device = deviceId ? devices.get(deviceId) : undefined;
    const rawTimezone = device?.timezone && device.timezone !== "UTC" ? device.timezone : null;
    const slot = extractDailySlot(startsAt, endsAt, rawTimezone);
    if (!slot) continue;

    const storedEndsMs = Date.parse(endsAt);
    const storedExpired = Number.isFinite(storedEndsMs) && storedEndsMs <= now.getTime();
    const storedStartsIso = Number.isFinite(Date.parse(startsAt)) ? new Date(startsAt).toISOString() : startsAt;

    for (const occurrence of projectDailyWindows(slot, now, horizonHours)) {
      const transition = deriveSessionTransitionTimestamps(occurrence.starts_at, occurrence.ends_at);
      const phase = transition ? classifySessionTransitionPhase(now, transition) : null;
      const operatorLabel = phase === "transition_buffer_active"
        ? "Transition buffer active"
        : phase === "preflight_due"
          ? "Preflight due"
          : phase === "session_open" && transition
            ? "Business actions until"
            : null;
      windows.push({
        account_id: accountId,
        username: usernames.get(accountId) || null,
        device_id: deviceId,
        device_name: device?.name ?? null,
        starts_at: occurrence.starts_at,
        ends_at: occurrence.ends_at,
        timezone: slot.timezone,
        local_slot: dailySlotLabel(slot),
        is_open: Date.parse(occurrence.starts_at) <= now.getTime() && now.getTime() < Date.parse(occurrence.ends_at),
        materialized: occurrence.starts_at === storedStartsIso,
        stored_window_expired: storedExpired,
        business_action_deadline: transition?.business_action_deadline ?? null,
        preflight_start: transition?.preflight_start ?? null,
        transition_phase: phase,
        transition_operator_label: operatorLabel,
      });
    }
  }
  windows.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || (a.username || "").localeCompare(b.username || ""));
  return windows;
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

/** Global configuration events written by the settings PATCH route. */
const SCHEDULER_CONFIG_ACTIONS = new Set(["auto_restart_settings_updated"]);

function readBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return null;
}

export function projectRecentDecision(usernames: Map<string, string>) {
  return (row: Record<string, unknown>): SchedulerRecentDecision => {
    const accountId = readString(row.account_id) || null;
    const metadata = row.metadata_safe && typeof row.metadata_safe === "object" && !Array.isArray(row.metadata_safe)
      ? (row.metadata_safe as Record<string, unknown>)
      : {};
    const username = (accountId ? usernames.get(accountId) : null) || readString(metadata.username) || null;
    const action = readString(row.action);
    const isConfigEvent = !accountId && SCHEDULER_CONFIG_ACTIONS.has(action);
    const normalizedReason = normalizeSchedulerReason(readString(row.reason));
    return {
      account_id: accountId,
      username,
      action,
      decision: readString(row.decision),
      reason: normalizedReason.raw,
      reason_code: normalizedReason.code,
      reason_kind: isConfigEvent ? "config" : normalizedReason.kind,
      event: isConfigEvent ? "scheduler_config" : "account_decision",
      config_enabled: isConfigEvent ? readBooleanOrNull(metadata.auto_restart_enabled) : null,
      created_at: readString(row.created_at),
    };
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
    /** Daily engine (schedule-session cron) env projection, provided by the route. */
    dailyEngineEnv?: { technicalEnabled: boolean; dryRun: boolean } | null;
    /** BotApp scheduler runtime gate projection for schedule-session cron. */
    dailyRuntimeGate?: SchedulerDailyRuntimeGate | null;
  },
): Promise<SchedulerStatus> {
  const now = options.now ?? new Date();
  const windowHours = options.decisionsWindowHours ?? SCHEDULER_DECISIONS_WINDOW_HOURS;
  const recentLimit = options.recentLimit ?? SCHEDULER_RECENT_DECISIONS_LIMIT;
  const sinceIso = new Date(now.getTime() - windowHours * 3_600_000).toISOString();

  const settingsRow = await loadSettingsRow(supabase);
  const [tickLocks, decisions, scheduledAssignments] = await Promise.all([
    loadRecentTickLocks(supabase),
    loadRecentDecisions(supabase, sinceIso),
    loadOpenScheduledAssignments(supabase),
  ]);

  const tickSummary = summarizeTickLocks(tickLocks);
  const decisionSummary = summarizeDecisions(decisions);

  const accountIds = Array.from(
    new Set([
      ...decisions.map((row) => readString(row.account_id)).filter(Boolean),
      ...scheduledAssignments.map((row) => readString(row.account_id)).filter(Boolean),
    ]),
  );
  const deviceIds = Array.from(
    new Set(scheduledAssignments.map((row) => readString(row.device_id)).filter(Boolean)),
  );
  const [usernames, deviceNames] = await Promise.all([
    loadUsernames(supabase, accountIds),
    loadDeviceNames(supabase, deviceIds),
  ]);
  const upcomingWindows = projectUpcomingWindows(scheduledAssignments, usernames, deviceNames, now);

  const dailySchedulerPipeline = await buildDailySchedulerPipeline(supabase, {
    upcomingWindows,
    usernames,
    now,
  });

  const recentDecisions: SchedulerRecentDecision[] = decisions.slice(0, recentLimit).map(projectRecentDecision(usernames));

  const checkEveryMinutes = readNumber(settingsRow?.check_every_minutes, 0);

  const backendMode = projectSchedulerBackendMode(settingsRow);
  const dailyEngine: SchedulerDailyEngine | null = options.dailyEngineEnv
    ? {
      technical_enabled: options.dailyEngineEnv.technicalEnabled,
      dry_run: options.dailyEngineEnv.dryRun,
      state: !options.dailyEngineEnv.technicalEnabled
        ? "technical_disabled"
        : options.dailyEngineEnv.dryRun
          ? "dry_run"
          : backendMode === "disabled_by_config"
            ? "scheduler_disabled"
            : "active",
    }
    : null;

  return {
    read_only: true,
    engine_status: projectSchedulerEngineStatus(options.engineHealth),
    engine_worker_id: options.engineHealth?.dispatcherWorkerId ?? null,
    engine_last_seen_at: options.engineHealth?.lastSeenAt ?? null,
    backend_mode: backendMode,
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
    daily_engine: dailyEngine,
    daily_runtime_gate: options.dailyRuntimeGate ?? null,
    windows_horizon_hours: SCHEDULE_PROJECTION_HORIZON_HOURS,
    upcoming_windows: upcomingWindows,
    daily_scheduler_pipeline: dailySchedulerPipeline,
  };
}
