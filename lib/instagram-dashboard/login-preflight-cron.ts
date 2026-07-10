import { timingSafeEqual } from "node:crypto";

import { loadSchedulerAutomaticRunAuthorization } from "./scheduler-authorization.ts";
import { buildDeviceLeaseUnavailableReconcileMetadata } from "./reconcile-stale-device-lock-before-preflight.ts";
import type { ReconcileStaleDeviceLockResult } from "./reconcile-stale-device-lock-before-preflight.ts";
import {
  assignmentIsInPreflightWindow,
  bindScheduledSessionPreflightRequest,
  buildPreflightRequestMetadata,
  preflightSlotBlocksNewEnqueue,
  upsertScheduledSessionPreflight,
} from "./scheduled-session-preflight.ts";

export type LoginPreflightCronReason =
  | "cron_disabled"
  | "cron_token_not_configured"
  | "missing_caller_token"
  | "invalid_caller_token"
  | "no_assignments"
  | "no_eligible_accounts"
  | "scheduler_disabled";

export type LoginPreflightCronEnv = {
  enabled: boolean;
  dryRun: boolean;
  configuredToken: string | null;
  workerId: string;
  limit: number;
  t10WindowMinutes: number;
  t5WindowMinutes: number;
  expectedDurationMinutes: number;
  deadlineSafetySeconds: number;
};

export type LoginPreflightCronSummary = {
  scanned_assignments_count: number;
  eligible_count: number;
  queued_count: number;
  skipped_scheduler_off_count: number;
  skipped_not_in_preflight_window_count: number;
  skipped_active_request_count: number;
  skipped_active_run_count: number;
  skipped_missing_assignment_target_count: number;
  skipped_duplicate_preflight_count: number;
  skipped_phone_busy_count: number;
  skipped_deadline_too_close_count: number;
  skipped_device_lease_unavailable_count: number;
  skipped_non_physical_phone_count: number;
  skipped_stale_heartbeat_count: number;
  skipped_preflight_ready_count: number;
  dashboard_action_count: number;
};

export type LoginPreflightCronResult = {
  enabled: boolean;
  dry_run: boolean;
  scheduler_enabled: boolean;
  worker_id: string;
  skipped: boolean;
  reason: LoginPreflightCronReason | null;
  summary: LoginPreflightCronSummary;
};

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  gte: (...args: unknown[]) => QueryBuilder;
  lte: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => Promise<QueryResult>;
};

const CRON_TOKEN_HEADER = "x-instagram-login-preflight-cron-token";
const PHYSICAL_PHONE_DEVICE_KIND = "physical_phone";
const HEARTBEAT_MAX_AGE_MINUTES = 15;
const activeRequestStatuses = ["queued", "claimed", "starting", "running"];
const activeRunStatuses = ["queued", "pending", "starting", "running", "in_progress", "active"];
const PREFLIGHT_RUN_TYPE = "scheduled_session_preflight";

function readEnvBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function readEnvInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function emptySummary(): LoginPreflightCronSummary {
  return {
    scanned_assignments_count: 0,
    eligible_count: 0,
    queued_count: 0,
    skipped_scheduler_off_count: 0,
    skipped_not_in_preflight_window_count: 0,
    skipped_active_request_count: 0,
    skipped_active_run_count: 0,
    skipped_missing_assignment_target_count: 0,
    skipped_duplicate_preflight_count: 0,
    skipped_phone_busy_count: 0,
    skipped_deadline_too_close_count: 0,
    skipped_device_lease_unavailable_count: 0,
    skipped_non_physical_phone_count: 0,
    skipped_stale_heartbeat_count: 0,
    skipped_preflight_ready_count: 0,
    dashboard_action_count: 0,
  };
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function safeWorkerId(value: string | undefined) {
  return (value || "login_preflight_cron").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "login_preflight_cron";
}

export function readLoginPreflightCronEnv(env: Record<string, string | undefined> = process.env): LoginPreflightCronEnv {
  const configuredToken =
    env.INSTAGRAM_LOGIN_PREFLIGHT_CRON_TOKEN?.trim()
    || env.INSTAGRAM_SCHEDULE_SESSION_CRON_TOKEN?.trim()
    || env.CRON_SECRET?.trim()
    || null;
  return {
    enabled: readEnvBoolean(env.INSTAGRAM_LOGIN_PREFLIGHT_CRON_ENABLED, false),
    dryRun: readEnvBoolean(env.INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN, true),
    configuredToken,
    workerId: safeWorkerId(env.INSTAGRAM_LOGIN_PREFLIGHT_CRON_WORKER_ID),
    limit: readEnvInteger(env.INSTAGRAM_LOGIN_PREFLIGHT_CRON_LIMIT, 10, 1, 50),
    t10WindowMinutes: readEnvInteger(env.INSTAGRAM_LOGIN_PREFLIGHT_T10_WINDOW_MINUTES, 10, 6, 20),
    t5WindowMinutes: readEnvInteger(env.INSTAGRAM_LOGIN_PREFLIGHT_T5_WINDOW_MINUTES, 5, 1, 10),
    expectedDurationMinutes: readEnvInteger(env.INSTAGRAM_LOGIN_PREFLIGHT_EXPECTED_DURATION_MINUTES, 3, 1, 10),
    deadlineSafetySeconds: readEnvInteger(env.INSTAGRAM_LOGIN_PREFLIGHT_DEADLINE_SAFETY_SECONDS, 60, 15, 300),
  };
}

export function extractLoginPreflightCronToken(request: Request) {
  const headerToken = request.headers.get(CRON_TOKEN_HEADER)?.trim();
  if (headerToken) return headerToken;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() ?? "";
}

function tokensMatch(expected: string, provided: string) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function skippedResult(
  env: LoginPreflightCronEnv,
  reason: LoginPreflightCronReason,
  summary = emptySummary(),
  schedulerEnabled = false,
): LoginPreflightCronResult {
  return {
    enabled: env.enabled,
    dry_run: env.dryRun,
    scheduler_enabled: schedulerEnabled,
    worker_id: env.workerId,
    skipped: true,
    reason,
    summary,
  };
}

function preflightPhase(startsAt: string, now: Date, env: LoginPreflightCronEnv) {
  const starts = new Date(startsAt).getTime();
  if (!Number.isFinite(starts)) return "t10";
  const minutesUntil = (starts - now.getTime()) / 60_000;
  return minutesUntil <= env.t5WindowMinutes ? "t5" : "t10";
}

function preflightIdempotencyKey(assignmentId: string, startsAt: string) {
  return `scheduled-preflight:${assignmentId}:${startsAt}`;
}

function hasEnoughRunway(startsAt: string, now: Date, env: LoginPreflightCronEnv) {
  const starts = new Date(startsAt).getTime();
  if (!Number.isFinite(starts)) return false;
  return now.getTime() + env.expectedDurationMinutes * 60_000 < starts;
}

async function listUpcomingAssignments(supabase: SupabaseLike, now: Date, env: LoginPreflightCronEnv) {
  const result = await query(supabase, "account_assignments")
    .select("id,account_id,device_id,app_instance_id,starts_at,ends_at,status,schedule_mode,assignment_type")
    .in("status", ["reserved", "active"])
    .eq("schedule_mode", "scheduled")
    .gte("starts_at", addMinutes(now, 0).toISOString())
    .lte("starts_at", addMinutes(now, env.t10WindowMinutes).toISOString())
    .order("starts_at", { ascending: true })
    .limit(env.limit) as QueryResult;

  if (result.error) throw new Error(result.error.message || "assignments_unavailable");
  return readRows(result.data).filter((row) => readString(row.assignment_type, "full_cycle") === "full_cycle");
}

async function listDevices(supabase: SupabaseLike, deviceIds: string[]) {
  if (!deviceIds.length) return new Map<string, Record<string, unknown>>();
  const result = await query(supabase, "phone_devices")
    .select("id,device_kind,status,timezone,name")
    .in("id", deviceIds)
    .limit(deviceIds.length) as QueryResult;
  if (result.error) throw new Error(result.error.message || "devices_unavailable");
  return new Map(readRows(result.data).map((row) => [readString(row.id), row]));
}

async function listDeviceHeartbeats(supabase: SupabaseLike, deviceIds: string[]) {
  if (!deviceIds.length) return new Map<string, Record<string, unknown>>();
  const result = await query(supabase, "device_heartbeats")
    .select("device_id,last_seen_at,status")
    .in("device_id", deviceIds)
    .limit(deviceIds.length) as QueryResult;
  if (result.error) throw new Error(result.error.message || "heartbeats_unavailable");
  return new Map(readRows(result.data).map((row) => [readString(row.device_id), row]));
}

async function listAccountUsernames(supabase: SupabaseLike, accountIds: string[]) {
  if (!accountIds.length) return new Map<string, string>();
  const result = await query(supabase, "ig_accounts")
    .select("id,username")
    .in("id", accountIds)
    .limit(accountIds.length) as QueryResult;
  if (result.error) throw new Error(result.error.message || "accounts_unavailable");
  return new Map(readRows(result.data).map((row) => [readString(row.id), readString(row.username)]));
}

async function listAppPackages(supabase: SupabaseLike, appInstanceIds: string[]) {
  if (!appInstanceIds.length) return new Map<string, string>();
  const result = await query(supabase, "phone_app_instances")
    .select("id,package_name")
    .in("id", appInstanceIds)
    .limit(appInstanceIds.length) as QueryResult;
  if (result.error) throw new Error(result.error.message || "app_instances_unavailable");
  return new Map(readRows(result.data).map((row) => [readString(row.id), readString(row.package_name)]));
}

async function listExistingPreflights(supabase: SupabaseLike, assignmentIds: string[]) {
  if (!assignmentIds.length) return new Map<string, Record<string, unknown>>();
  const result = await query(supabase, "scheduled_session_preflights")
    .select("assignment_id,scheduled_window_start,status,request_id")
    .in("assignment_id", assignmentIds)
    .limit(assignmentIds.length * 2) as QueryResult;
  if (result.error) throw new Error(result.error.message || "preflights_unavailable");
  const map = new Map<string, Record<string, unknown>>();
  for (const row of readRows(result.data)) {
    const key = `${readString(row.assignment_id)}:${readString(row.scheduled_window_start)}`;
    map.set(key, row);
  }
  return map;
}

async function listPeerAssignments(supabase: SupabaseLike, deviceIds: string[]) {
  if (!deviceIds.length) return [];
  const result = await query(supabase, "account_assignments")
    .select("account_id,device_id,app_instance_id,status")
    .in("status", ["reserved", "active"])
    .in("device_id", deviceIds)
    .limit(500) as QueryResult;
  if (result.error) throw new Error(result.error.message || "peer_assignments_unavailable");
  return readRows(result.data);
}

async function listActiveRequests(supabase: SupabaseLike, accountIds: string[]) {
  if (!accountIds.length) return [];
  const result = await query(supabase, "account_run_requests")
    .select("account_id,status,requested_run_type,idempotency_key,metadata_safe")
    .in("account_id", accountIds)
    .in("status", activeRequestStatuses)
    .limit(accountIds.length * 2) as QueryResult;
  if (result.error) throw new Error(result.error.message || "active_requests_unavailable");
  return readRows(result.data);
}

async function listActiveRuns(supabase: SupabaseLike, accountIds: string[]) {
  if (!accountIds.length) return [];
  const result = await query(supabase, "ig_runs")
    .select("account_id,status")
    .in("account_id", accountIds)
    .in("status", activeRunStatuses)
    .limit(accountIds.length * 2) as QueryResult;
  if (result.error) throw new Error(result.error.message || "active_runs_unavailable");
  return readRows(result.data);
}

function heartbeatFresh(lastSeenAt: string | null | undefined, now: Date) {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) return false;
  return now.getTime() - seen <= HEARTBEAT_MAX_AGE_MINUTES * 60_000;
}

async function queueScheduledPreflight(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    startsAt: string;
    endsAt: string;
    phase: string;
    workerId: string;
    preflightId: string;
  },
) {
  const { data, error } = await supabase.rpc("create_account_run_request", {
    p_account_id: input.accountId,
    p_requested_by: null,
    p_actor_type: "system",
    p_source_surface: "instagram_login_preflight_cron",
    p_requested_run_type: PREFLIGHT_RUN_TYPE,
    p_idempotency_key: preflightIdempotencyKey(input.assignmentId, input.startsAt),
    p_priority: input.phase === "t5" ? 5 : 1,
    p_metadata_safe: buildPreflightRequestMetadata({
      assignmentId: input.assignmentId,
      workerId: input.workerId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      preflightId: input.preflightId,
      phase: input.phase,
    }),
  });
  if (error) throw new Error(error.message || "scheduled_preflight_enqueue_failed");
  return data;
}

async function upsertPreflightAction(supabase: SupabaseLike, input: { accountId: string; assignmentId: string; startsAt: string; status: string }) {
  await supabase.rpc("upsert_account_dashboard_action", {
    p_account_id: input.accountId,
    p_client_id: null,
    p_incident_id: null,
    p_action_type: "scheduled_session_preflight",
    p_status: input.status === "preflight_ready" ? "completed" : "pending",
    p_title: "Scheduled session preflight",
    p_dedupe_key: `account:${input.accountId}:scheduled_preflight:${input.assignmentId}:${input.startsAt}`,
    p_safe_client_message: null,
    p_admin_message: `Scheduled session preflight state: ${input.status}.`,
    p_assistant_message: null,
    p_action_label: "Monitor",
    p_action_deep_link: "/instagram-dashboard/devices",
    p_severity: input.status === "preflight_blocked" ? "warning" : "info",
    p_audience: "admin",
    p_requires_client_action: false,
    p_blocking_campaign: false,
    p_metadata: {
      source: "login_preflight_cron",
      assignment_id: input.assignmentId,
      scheduled_session_at: input.startsAt,
      preflight_status: input.status,
    },
  });
}

export async function runLoginPreflightCron(
  supabase: SupabaseLike,
  options: { callerToken?: string | null; env?: Record<string, string | undefined>; now?: Date } = {},
): Promise<{ status: 200 | 401 | 403 | 503; result: LoginPreflightCronResult }> {
  const env = readLoginPreflightCronEnv(options.env);
  if (!env.configuredToken) return { status: 503, result: skippedResult(env, "cron_token_not_configured") };
  const callerToken = options.callerToken?.trim() ?? "";
  if (!callerToken) return { status: 401, result: skippedResult(env, "missing_caller_token") };
  if (!tokensMatch(env.configuredToken, callerToken)) return { status: 403, result: skippedResult(env, "invalid_caller_token") };
  if (!env.enabled) return { status: 200, result: skippedResult(env, "cron_disabled") };

  const now = options.now ?? new Date();
  const schedulerAuthorization = await loadSchedulerAutomaticRunAuthorization(supabase);
  const assignments = await listUpcomingAssignments(supabase, now, env);
  const summary = emptySummary();
  summary.scanned_assignments_count = assignments.length;
  if (!assignments.length) {
    return {
      status: 200,
      result: {
        enabled: true,
        dry_run: env.dryRun,
        scheduler_enabled: schedulerAuthorization.enabled,
        worker_id: env.workerId,
        skipped: true,
        reason: "no_assignments",
        summary,
      },
    };
  }

  const deviceIds = [...new Set(assignments.map((row) => readString(row.device_id)).filter(Boolean))];
  const appInstanceIds = [...new Set(assignments.map((row) => readString(row.app_instance_id)).filter(Boolean))];
  const assignmentIds = assignments.map((row) => readString(row.id)).filter(Boolean);
  const accountIds = [...new Set(assignments.map((row) => readString(row.account_id)).filter(Boolean))];

  const [devicesById, heartbeatsByDevice, usernamesByAccount, packagesByApp, existingPreflights, peerAssignments, activeRequests, activeRuns] = await Promise.all([
    listDevices(supabase, deviceIds),
    listDeviceHeartbeats(supabase, deviceIds),
    listAccountUsernames(supabase, accountIds),
    listAppPackages(supabase, appInstanceIds),
    listExistingPreflights(supabase, assignmentIds),
    listPeerAssignments(supabase, deviceIds),
    listActiveRequests(supabase, accountIds),
    listActiveRuns(supabase, accountIds),
  ]);

  const activeRequestAccounts = new Set(activeRequests.map((row) => readString(row.account_id)).filter(Boolean));
  const activeRunAccounts = new Set(activeRuns.map((row) => readString(row.account_id)).filter(Boolean));
  const activeRequestKeys = new Set(activeRequests.map((row) => readString(row.idempotency_key)).filter(Boolean));

  for (const assignment of assignments) {
    const assignmentId = readString(assignment.id);
    const accountId = readString(assignment.account_id);
    const deviceId = readString(assignment.device_id);
    const appInstanceId = readString(assignment.app_instance_id);
    const startsAt = readString(assignment.starts_at);
    const endsAt = readString(assignment.ends_at);
    if (!assignmentId || !accountId || !deviceId || !appInstanceId || !startsAt || !endsAt) {
      summary.skipped_missing_assignment_target_count += 1;
      continue;
    }

    const window = assignmentIsInPreflightWindow(now, startsAt, endsAt);
    if (!window.eligible || !window.timestamps) {
      summary.skipped_not_in_preflight_window_count += 1;
      continue;
    }

    const device = devicesById.get(deviceId);
    if (readString(device?.device_kind).toLowerCase() !== PHYSICAL_PHONE_DEVICE_KIND) {
      summary.skipped_non_physical_phone_count += 1;
      continue;
    }
    const heartbeat = heartbeatsByDevice.get(deviceId);
    if (!heartbeatFresh(readString(heartbeat?.last_seen_at), now)) {
      summary.skipped_stale_heartbeat_count += 1;
      continue;
    }

    const existingKey = `${assignmentId}:${window.timestamps.session_start}`;
    const existing = existingPreflights.get(existingKey);
    const existingStatus = readString(existing?.status);
    if (preflightSlotBlocksNewEnqueue(existingStatus)) {
      if (existingStatus === "preflight_ready") {
        summary.skipped_preflight_ready_count += 1;
      } else if (existingStatus === "preflight_running") {
        summary.skipped_duplicate_preflight_count += 1;
      } else {
        summary.skipped_duplicate_preflight_count += 1;
      }
      continue;
    }

    const phase = preflightPhase(startsAt, now, env);
    const idempotencyKey = preflightIdempotencyKey(assignmentId, startsAt);
    if (activeRequestKeys.has(idempotencyKey)) {
      summary.skipped_duplicate_preflight_count += 1;
      continue;
    }
    if (activeRequestAccounts.has(accountId)) {
      summary.skipped_active_request_count += 1;
      continue;
    }
    if (activeRunAccounts.has(accountId)) {
      summary.skipped_active_run_count += 1;
      continue;
    }
    const busyPeerAccounts = peerAssignments
      .filter((row) => readString(row.account_id) !== accountId)
      .filter((row) => readString(row.device_id) === deviceId || readString(row.app_instance_id) === appInstanceId)
      .map((row) => readString(row.account_id))
      .filter(Boolean);
    if (busyPeerAccounts.some((peerAccountId) => activeRequestAccounts.has(peerAccountId) || activeRunAccounts.has(peerAccountId))) {
      summary.skipped_phone_busy_count += 1;
      continue;
    }
    if (!hasEnoughRunway(startsAt, now, env)) {
      summary.skipped_deadline_too_close_count += 1;
      continue;
    }

    const expectedPackage = packagesByApp.get(appInstanceId) || "";
    const expectedUsername = usernamesByAccount.get(accountId) || "";

    if (!schedulerAuthorization.allowed) {
      summary.skipped_scheduler_off_count += 1;
      if (!env.dryRun) {
        await upsertScheduledSessionPreflight(supabase, {
          accountId,
          assignmentId,
          deviceId,
          appInstanceId,
          expectedPackage,
          expectedUsername,
          startsAt,
          endsAt,
          status: "preflight_skipped_scheduler_off",
          reasonCode: "scheduler_disabled",
        });
      }
      continue;
    }

    summary.eligible_count += 1;
    if (env.dryRun) continue;

    const preflightRow = await upsertScheduledSessionPreflight(supabase, {
      accountId,
      assignmentId,
      deviceId,
      appInstanceId,
      expectedPackage,
      expectedUsername,
      startsAt,
      endsAt,
      status: "preflight_due",
    });
    if (!preflightRow?.id) continue;

    const enqueued = await queueScheduledPreflight(supabase, {
      accountId,
      assignmentId,
      startsAt,
      endsAt,
      phase,
      workerId: env.workerId,
      preflightId: preflightRow.id,
    });
    const requestRow = (Array.isArray(enqueued) ? enqueued[0] : enqueued) as Record<string, unknown> | null;
    const requestId = readString(requestRow?.id);
    let leaseOk = true;
    let leaseReconcile: ReconcileStaleDeviceLockResult | undefined;
    if (requestId) {
      const { leaseRequestOrCancel } = await import("./device-ui-lease.ts");
      const leased = await leaseRequestOrCancel(supabase, {
        deviceId,
        accountId,
        appInstanceId,
        requestId,
        reason: "scheduled_session_preflight",
        ownerKind: "preflight",
        operationPhase: "queued",
      });
      leaseOk = leased.ok;
      if (!leased.ok) {
        leaseReconcile = leased.reconcile;
      }
      if (leaseOk) {
        await bindScheduledSessionPreflightRequest(supabase, {
          preflightId: preflightRow.id,
          requestId,
        });
      }
    }
    if (!leaseOk) {
      summary.skipped_device_lease_unavailable_count += 1;
      await upsertScheduledSessionPreflight(supabase, {
        accountId,
        assignmentId,
        deviceId,
        appInstanceId,
        expectedPackage,
        expectedUsername,
        startsAt,
        endsAt,
        status: "preflight_lease_unavailable",
        reasonCode: "device_lease_unavailable",
        metadataSafe: buildDeviceLeaseUnavailableReconcileMetadata(leaseReconcile),
      });
      continue;
    }
    summary.queued_count += 1;
    await upsertPreflightAction(supabase, { accountId, assignmentId, startsAt, status: "preflight_running" });
    summary.dashboard_action_count += 1;
  }

  return {
    status: 200,
    result: {
      enabled: true,
      dry_run: env.dryRun,
      scheduler_enabled: schedulerAuthorization.enabled,
      worker_id: env.workerId,
      skipped: summary.eligible_count === 0 && summary.skipped_scheduler_off_count === 0,
      reason: summary.eligible_count === 0 && summary.skipped_scheduler_off_count === 0 ? "no_eligible_accounts" : null,
      summary,
    },
  };
}
