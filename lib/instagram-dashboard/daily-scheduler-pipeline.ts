/**
 * Daily Scheduler pipeline read-model — observability only.
 *
 * Projects tick → preflight → account_session from persisted facts:
 * scheduled_session_preflights, account_run_requests, ig_runs.
 * Never decides eligibility and never creates runs.
 */

import {
  classifySessionTransitionPhase,
  deriveSessionTransitionTimestamps,
} from "./session-transition-buffer.ts";
import { mapPreflightRow, type ScheduledSessionPreflightRow } from "./scheduled-session-preflight.ts";
import type { SchedulerUpcomingWindow } from "./scheduler-status.ts";

export type DailySchedulerPipelineStatus =
  | "waiting_for_window"
  | "waiting_for_t10"
  | "preflight_due"
  | "preflight_queued"
  | "preflight_claimed"
  | "preflight_running"
  | "preflight_ready"
  | "preflight_blocked"
  | "preflight_expired"
  | "preflight_lease_unavailable"
  | "account_session_queued"
  | "account_session_claimed"
  | "account_session_running"
  | "account_session_completed"
  | "account_session_failed"
  | "no_action";

export type DailySchedulerPreflightProjection = {
  preflight_id: string;
  request_id: string | null;
  phase: "t10" | "late" | null;
  status: string;
  reason_code: string | null;
  screen_type: string | null;
  detection_reason: string | null;
  identity_guard_stage: string | null;
  expected_username: string | null;
  actual_logged_in_username: string | null;
  screenshot_captured: boolean | null;
  xml_dump_captured: boolean | null;
  unlock_attempted: boolean | null;
  unlock_result: string | null;
  worker_id: string | null;
  updated_at: string | null;
};

export type DailySchedulerAccountSessionProjection = {
  exists: boolean;
  request_id: string | null;
  status: string | null;
  worker_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  reason: string | null;
  phone_state: "idle" | "busy" | "running";
};

export type DailySchedulerPipelineAccount = {
  account_id: string;
  username: string | null;
  phone_name: string | null;
  package_name: string | null;
  current_window: string | null;
  next_window: string | null;
  pipeline_status: DailySchedulerPipelineStatus;
  preflight: DailySchedulerPreflightProjection | null;
  account_session: DailySchedulerAccountSessionProjection;
  account_session_absent_reason: string | null;
};

export type DailySchedulerPipelineGlobal = {
  last_cron_at: string | null;
  last_success_at: string | null;
  accounts_evaluated: number;
  last_evaluated_account_id: string | null;
  last_evaluated_username: string | null;
  last_daily_block_reason: string | null;
};

export type DailySchedulerPipeline = {
  global: DailySchedulerPipelineGlobal;
  accounts: DailySchedulerPipelineAccount[];
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  gte: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
};

export type DailySchedulerPipelineSupabase = {
  from: (table: string) => unknown;
};

function query(supabase: DailySchedulerPipelineSupabase, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return null;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function readMetadata(row: Record<string, unknown> | null | undefined) {
  const meta = row?.metadata_safe;
  return meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
}

function isScheduleSessionSource(meta: Record<string, unknown>) {
  const source = readString(meta.source).toLowerCase();
  const trigger = readString(meta.trigger).toLowerCase();
  return source === "schedule_session_cron" || trigger === "scheduler";
}

function projectPreflightDetails(row: ScheduledSessionPreflightRow | null): DailySchedulerPreflightProjection | null {
  if (!row) return null;
  const meta = row.metadata_safe || {};
  const late = meta.late_preflight === true;
  return {
    preflight_id: row.id,
    request_id: row.request_id,
    phase: late ? "late" : row.id ? "t10" : null,
    status: row.status,
    reason_code: row.reason_code,
    screen_type: readString(meta.screen_type) || null,
    detection_reason: readString(meta.detection_reason) || null,
    identity_guard_stage: readString(meta.identity_guard_stage) || null,
    expected_username: row.expected_username || readString(meta.expected_account_username) || null,
    actual_logged_in_username: readString(meta.actual_logged_in_username) || null,
    screenshot_captured: readBoolean(meta.screenshot_captured),
    xml_dump_captured: readBoolean(meta.xml_dump_captured),
    unlock_attempted: readBoolean(meta.unlock_attempted),
    unlock_result: readString(meta.unlock_result) || null,
    worker_id: readString(meta.worker_id) || null,
    updated_at: row.updated_at || row.checked_at || null,
  };
}

function mapRequestStatus(status: string) {
  return readString(status).toLowerCase();
}

function derivePhoneState(request: Record<string, unknown> | null, run: Record<string, unknown> | null): "idle" | "busy" | "running" {
  const runStatus = readString(run?.status).toLowerCase();
  if (["running", "claimed", "starting"].includes(runStatus)) return "running";
  const requestStatus = mapRequestStatus(readString(request?.status));
  if (["claimed", "running"].includes(requestStatus)) return "running";
  if (requestStatus === "pending" || requestStatus === "reserved") return "busy";
  return "idle";
}

function deriveAccountSessionAbsentReason(input: {
  pipelineStatus: DailySchedulerPipelineStatus;
  preflight: DailySchedulerPreflightProjection | null;
  windowOpen: boolean;
  deadlinePassed: boolean;
}): string | null {
  if (input.pipelineStatus.startsWith("account_session_")) return null;
  const reason = readString(input.preflight?.reason_code);
  if (reason === "device_locked") return "No account session — device locked";
  if (reason === "device_locked_requires_operator") return "No account session — device locked";
  if (input.preflight?.status === "preflight_blocked" && reason) {
    return `No account session — preflight blocked: ${reason}`;
  }
  if (input.preflight?.status === "preflight_blocked") {
    return "No account session — preflight blocked";
  }
  if (input.deadlinePassed) return "No account session — deadline passed";
  if (!input.windowOpen && input.pipelineStatus === "waiting_for_window") {
    return "No account session — outside window";
  }
  if (input.preflight?.status !== "preflight_ready") {
    return "No account session — waiting for preflight_ready";
  }
  return "No account session — waiting for preflight_ready";
}

export function derivePipelineStatus(input: {
  now: Date;
  window: SchedulerUpcomingWindow | null;
  preflight: ScheduledSessionPreflightRow | null;
  preflightRequest: Record<string, unknown> | null;
  accountSessionRequest: Record<string, unknown> | null;
  igRun: Record<string, unknown> | null;
}): DailySchedulerPipelineStatus {
  const runStatus = readString(input.igRun?.status).toLowerCase();
  const sessionRequestStatus = mapRequestStatus(readString(input.accountSessionRequest?.status));
  const preflightRequestStatus = mapRequestStatus(readString(input.preflightRequest?.status));

  if (runStatus === "running" || sessionRequestStatus === "running") return "account_session_running";
  if (sessionRequestStatus === "claimed") return "account_session_claimed";
  if (sessionRequestStatus === "pending" || sessionRequestStatus === "reserved") return "account_session_queued";
  if (["completed", "stopped"].includes(runStatus) || sessionRequestStatus === "completed") return "account_session_completed";
  if (["failed", "canceled", "cancelled"].includes(runStatus) || ["failed", "canceled", "cancelled"].includes(sessionRequestStatus)) {
    return "account_session_failed";
  }

  if (preflightRequestStatus === "claimed") return "preflight_claimed";
  if (preflightRequestStatus === "running") return "preflight_running";

  const preflightStatus = readString(input.preflight?.status);
  if (preflightStatus === "preflight_running") return "preflight_running";
  if (preflightStatus === "preflight_ready") return "preflight_ready";
  if (preflightStatus === "preflight_blocked") return "preflight_blocked";
  if (preflightStatus === "preflight_expired") return "preflight_expired";
  if (preflightStatus === "preflight_lease_unavailable") return "preflight_lease_unavailable";
  if (preflightStatus === "preflight_due") return "preflight_due";
  if (preflightRequestStatus === "pending" || preflightRequestStatus === "reserved") return "preflight_queued";

  const window = input.window;
  if (window) {
    const transition = deriveSessionTransitionTimestamps(window.starts_at, window.ends_at);
    if (transition) {
      const phase = classifySessionTransitionPhase(input.now, transition);
      if (phase === "before_preflight") return "waiting_for_t10";
      if (phase === "preflight_due") return "preflight_due";
      if (phase === "session_ended") return "preflight_expired";
    }
    if (!window.is_open && Date.parse(window.starts_at) > input.now.getTime()) return "waiting_for_window";
  }

  return "no_action";
}

async function loadPreflightsForAccounts(supabase: DailySchedulerPipelineSupabase, accountIds: string[]) {
  const map = new Map<string, ScheduledSessionPreflightRow>();
  if (!accountIds.length) return map;
  const result = await query(supabase, "scheduled_session_preflights")
    .select("*")
    .in("account_id", accountIds)
    .order("updated_at", { ascending: false })
    .limit(Math.min(accountIds.length * 4, 80));
  for (const row of readRows(result.data)) {
    const mapped = mapPreflightRow(row);
    if (!mapped?.account_id || map.has(mapped.account_id)) continue;
    map.set(mapped.account_id, mapped);
  }
  return map;
}

async function loadRunRequestsForAccounts(supabase: DailySchedulerPipelineSupabase, accountIds: string[]) {
  const byAccount = new Map<string, { preflight: Record<string, unknown> | null; accountSession: Record<string, unknown> | null }>();
  if (!accountIds.length) return byAccount;
  const result = await query(supabase, "account_run_requests")
    .select("id,account_id,status,requested_run_type,run_id,created_at,updated_at,claimed_at,completed_at,worker_id,metadata_safe,reason_code")
    .in("account_id", accountIds)
    .order("created_at", { ascending: false })
    .limit(Math.min(accountIds.length * 6, 120));
  for (const row of readRows(result.data)) {
    const accountId = readString(row.account_id);
    if (!accountId) continue;
    const bucket = byAccount.get(accountId) || { preflight: null, accountSession: null };
    const runType = readString(row.requested_run_type).toLowerCase();
    if (runType === "scheduled_session_preflight" && !bucket.preflight) bucket.preflight = row;
    if (runType === "account_session" && !bucket.accountSession) bucket.accountSession = row;
    byAccount.set(accountId, bucket);
  }
  return byAccount;
}

async function loadRunsById(supabase: DailySchedulerPipelineSupabase, runIds: string[]) {
  const map = new Map<string, Record<string, unknown>>();
  const ids = Array.from(new Set(runIds.filter(Boolean)));
  if (!ids.length) return map;
  const result = await query(supabase, "ig_runs")
    .select("id,status,started_at,finished_at,exit_code,metadata_safe")
    .in("id", ids)
    .limit(ids.length);
  for (const row of readRows(result.data)) {
    const id = readString(row.id);
    if (id) map.set(id, row);
  }
  return map;
}

async function loadPackages(supabase: DailySchedulerPipelineSupabase, appInstanceIds: string[]) {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(appInstanceIds.filter(Boolean)));
  if (!ids.length) return map;
  const result = await query(supabase, "phone_app_instances")
    .select("id,package_name")
    .in("id", ids)
    .limit(ids.length);
  for (const row of readRows(result.data)) {
    const id = readString(row.id);
    const pkg = readString(row.package_name);
    if (id && pkg) map.set(id, pkg);
  }
  return map;
}

async function loadRecentScheduleActivity(supabase: DailySchedulerPipelineSupabase, sinceIso: string) {
  const [preflights, requests] = await Promise.all([
    query(supabase, "scheduled_session_preflights")
      .select("account_id,updated_at,status,reason_code")
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .limit(50),
    query(supabase, "account_run_requests")
      .select("account_id,created_at,updated_at,status,requested_run_type,metadata_safe,reason_code")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  let lastCronAt: string | null = null;
  let lastSuccessAt: string | null = null;
  let lastBlockReason: string | null = null;
  let lastEvaluatedAccountId: string | null = null;
  let lastEvaluatedUsername: string | null = null;
  const evaluated = new Set<string>();

  for (const row of readRows(preflights.data)) {
    const accountId = readString(row.account_id);
    const updatedAt = readString(row.updated_at);
    if (accountId) evaluated.add(accountId);
    if (updatedAt && (!lastCronAt || updatedAt > lastCronAt)) {
      lastCronAt = updatedAt;
      lastEvaluatedAccountId = accountId || null;
    }
    const status = readString(row.status);
    if (status === "preflight_ready" && updatedAt && (!lastSuccessAt || updatedAt > lastSuccessAt)) {
      lastSuccessAt = updatedAt;
    }
    if (status === "preflight_blocked") {
      const reason = readString(row.reason_code);
      if (updatedAt && reason && (!lastBlockReason || updatedAt > lastCronAt!)) lastBlockReason = reason;
    }
  }

  for (const row of readRows(requests.data)) {
    const meta = readMetadata(row);
    if (!isScheduleSessionSource(meta)) continue;
    const accountId = readString(row.account_id);
    const createdAt = readString(row.created_at);
    const updatedAt = readString(row.updated_at) || createdAt;
    if (accountId) evaluated.add(accountId);
    if (updatedAt && (!lastCronAt || updatedAt > lastCronAt)) {
      lastCronAt = updatedAt;
      lastEvaluatedAccountId = accountId || null;
    }
    const status = mapRequestStatus(readString(row.status));
    if (status === "completed" && updatedAt && (!lastSuccessAt || updatedAt > lastSuccessAt)) {
      lastSuccessAt = updatedAt;
    }
  }

  return {
    lastCronAt,
    lastSuccessAt,
    lastBlockReason,
    lastEvaluatedAccountId,
    evaluatedCount: evaluated.size,
  };
}

function pickPrimaryWindow(windows: SchedulerUpcomingWindow[], accountId: string, now: Date) {
  const rows = windows.filter((window) => window.account_id === accountId);
  if (!rows.length) return { current: null, next: null };
  const open = rows.find((window) => window.is_open) || null;
  const upcoming = rows
    .filter((window) => Date.parse(window.starts_at) > now.getTime())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] || null;
  return { current: open || upcoming, next: open ? upcoming : upcoming };
}

export async function buildDailySchedulerPipeline(
  supabase: DailySchedulerPipelineSupabase,
  input: {
    upcomingWindows: SchedulerUpcomingWindow[];
    usernames: Map<string, string>;
    now?: Date;
  },
): Promise<DailySchedulerPipeline> {
  const now = input.now ?? new Date();
  const sinceIso = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const accountIds = Array.from(new Set(input.upcomingWindows.map((window) => window.account_id).filter(Boolean)));
  const [
    activity,
    preflights,
    requestsByAccount,
  ] = await Promise.all([
    loadRecentScheduleActivity(supabase, sinceIso),
    loadPreflightsForAccounts(supabase, accountIds),
    loadRunRequestsForAccounts(supabase, accountIds),
  ]);
  const packages = await loadPackages(
    supabase,
    Array.from(preflights.values()).map((row) => row.app_instance_id).filter(Boolean),
  );

  const runIds = Array.from(requestsByAccount.values())
    .map((bucket) => readString(bucket.accountSession?.run_id))
    .filter(Boolean);
  const runs = await loadRunsById(supabase, runIds);

  const accounts: DailySchedulerPipelineAccount[] = accountIds.map((accountId) => {
    const { current, next } = pickPrimaryWindow(input.upcomingWindows, accountId, now);
    const window = current;
    const preflightRow = preflights.get(accountId) || null;
    const requests = requestsByAccount.get(accountId) || { preflight: null, accountSession: null };
    const igRun = requests.accountSession ? runs.get(readString(requests.accountSession.run_id)) || null : null;
    const pipelineStatus = derivePipelineStatus({
      now,
      window,
      preflight: preflightRow,
      preflightRequest: requests.preflight,
      accountSessionRequest: requests.accountSession,
      igRun,
    });
    const preflight = projectPreflightDetails(preflightRow);
    const sessionMeta = readMetadata(requests.accountSession);
    const accountSession: DailySchedulerAccountSessionProjection = {
      exists: Boolean(requests.accountSession),
      request_id: readString(requests.accountSession?.id) || null,
      status: readString(requests.accountSession?.status) || null,
      worker_id: readString(requests.accountSession?.worker_id) || readString(sessionMeta.worker_id) || null,
      started_at: readString(requests.accountSession?.claimed_at) || readString(igRun?.started_at) || null,
      completed_at: readString(requests.accountSession?.completed_at) || readString(igRun?.finished_at) || null,
      reason: readString(requests.accountSession?.reason_code) || readString(igRun?.metadata_safe && typeof igRun.metadata_safe === "object" ? (igRun.metadata_safe as Record<string, unknown>).failure_reason : "") || null,
      phone_state: derivePhoneState(requests.accountSession, igRun),
    };
    const deadlinePassed = window?.business_action_deadline
      ? now.getTime() >= Date.parse(window.business_action_deadline)
      : false;
    return {
      account_id: accountId,
      username: input.usernames.get(accountId) || window?.username || null,
      phone_name: window?.device_name || null,
      package_name: preflightRow ? packages.get(preflightRow.app_instance_id) || preflightRow.expected_package || null : null,
      current_window: window?.local_slot || null,
      next_window: next?.local_slot || null,
      pipeline_status: pipelineStatus,
      preflight,
      account_session: accountSession,
      account_session_absent_reason: deriveAccountSessionAbsentReason({
        pipelineStatus,
        preflight,
        windowOpen: Boolean(window?.is_open),
        deadlinePassed,
      }),
    };
  });

  accounts.sort((a, b) => (a.username || a.account_id).localeCompare(b.username || b.account_id));

  const lastEvaluatedUsername = activity.lastEvaluatedAccountId
    ? (input.usernames.get(activity.lastEvaluatedAccountId) || null)
    : null;

  return {
    global: {
      last_cron_at: activity.lastCronAt,
      last_success_at: activity.lastSuccessAt,
      accounts_evaluated: activity.evaluatedCount,
      last_evaluated_account_id: activity.lastEvaluatedAccountId,
      last_evaluated_username: lastEvaluatedUsername,
      last_daily_block_reason: activity.lastBlockReason,
    },
    accounts,
  };
}
