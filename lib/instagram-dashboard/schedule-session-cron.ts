import { timingSafeEqual } from "node:crypto";

const ASSIGNMENT_HEARTBEAT_STALE_MS = 15 * 60 * 1000;
const PHYSICAL_PHONE_DEVICE_KIND = "physical_phone";
const EMULATOR_DEVICE_KIND = "emulator";

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function normalizeDeviceKind(value: unknown) {
  return readString(value, "").toLowerCase();
}

function isPhysicalPhoneDevice(device: { device_kind?: unknown } | null | undefined) {
  return normalizeDeviceKind(device?.device_kind) === PHYSICAL_PHONE_DEVICE_KIND;
}

function isEmulatorDevice(device: { device_kind?: unknown } | null | undefined) {
  return normalizeDeviceKind(device?.device_kind) === EMULATOR_DEVICE_KIND;
}

function isAssignmentHeartbeatLive(
  heartbeat: { status?: unknown; last_seen_at?: unknown } | null | undefined,
  now = new Date(),
) {
  if (!heartbeat) return false;
  if (readString(heartbeat.status, "").toLowerCase() !== "online") return false;
  const lastSeenAt = readString(heartbeat.last_seen_at, "");
  if (!lastSeenAt) return false;
  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return false;
  return now.getTime() - lastSeenMs <= ASSIGNMENT_HEARTBEAT_STALE_MS;
}

export type ScheduleSessionCronReason =
  | "cron_disabled"
  | "cron_token_not_configured"
  | "missing_caller_token"
  | "invalid_caller_token"
  | "no_active_windows"
  | "no_eligible_accounts";

export type ScheduleSessionCronEnv = {
  enabled: boolean;
  dryRun: boolean;
  configuredToken: string | null;
  workerId: string;
  limit: number;
};

export type ScheduleSessionCronSummary = {
  scanned_assignments_count: number;
  eligible_count: number;
  queued_count: number;
  skipped_outside_window_count: number;
  skipped_manual_only_count: number;
  skipped_active_request_count: number;
  skipped_active_run_count: number;
  skipped_duplicate_slot_count: number;
  skipped_phone_busy_count: number;
  skipped_emulator_device_count: number;
  skipped_stale_device_count: number;
  skipped_eligibility_count: number;
  skipped_missing_assignment_target_count: number;
};

export type ScheduleSessionCronResult = {
  enabled: boolean;
  dry_run: boolean;
  worker_id: string;
  skipped: boolean;
  reason: ScheduleSessionCronReason | null;
  summary: ScheduleSessionCronSummary;
};

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  lte: (...args: unknown[]) => QueryBuilder;
  gt: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => Promise<QueryResult>;
};

const CRON_TOKEN_HEADER = "x-instagram-schedule-session-cron-token";
const activeRequestStatuses = ["queued", "claimed", "starting", "running"];
const activeRunStatuses = ["queued", "pending", "starting", "running", "in_progress", "active"];

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

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function emptySummary(): ScheduleSessionCronSummary {
  return {
    scanned_assignments_count: 0,
    eligible_count: 0,
    queued_count: 0,
    skipped_outside_window_count: 0,
    skipped_manual_only_count: 0,
    skipped_active_request_count: 0,
    skipped_active_run_count: 0,
    skipped_duplicate_slot_count: 0,
    skipped_phone_busy_count: 0,
    skipped_emulator_device_count: 0,
    skipped_stale_device_count: 0,
    skipped_eligibility_count: 0,
    skipped_missing_assignment_target_count: 0,
  };
}

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function safeWorkerId(value: string | undefined) {
  return (value || "schedule_session_cron").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "schedule_session_cron";
}

export function readScheduleSessionCronEnv(env: Record<string, string | undefined> = process.env): ScheduleSessionCronEnv {
  return {
    enabled: readEnvBoolean(env.INSTAGRAM_SCHEDULE_SESSION_CRON_ENABLED, false),
    dryRun: readEnvBoolean(env.INSTAGRAM_SCHEDULE_SESSION_CRON_DRY_RUN, true),
    configuredToken: env.INSTAGRAM_SCHEDULE_SESSION_CRON_TOKEN?.trim() || null,
    workerId: safeWorkerId(env.INSTAGRAM_SCHEDULE_SESSION_CRON_WORKER_ID),
    limit: readEnvInteger(env.INSTAGRAM_SCHEDULE_SESSION_CRON_LIMIT, 10, 1, 50),
  };
}

export function extractScheduleSessionCronToken(request: Request) {
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

function skippedResult(env: ScheduleSessionCronEnv, reason: ScheduleSessionCronReason, summary = emptySummary()): ScheduleSessionCronResult {
  return {
    enabled: env.enabled,
    dry_run: env.dryRun,
    worker_id: env.workerId,
    skipped: true,
    reason,
    summary,
  };
}

export function assignmentWindowActive(startsAt: string, endsAt: string, now: Date) {
  const startsMs = new Date(startsAt).getTime();
  const endsMs = new Date(endsAt).getTime();
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) return false;
  const nowMs = now.getTime();
  return startsMs <= nowMs && nowMs < endsMs;
}

export function scheduleSessionIdempotencyKey(assignmentId: string, startsAt: string) {
  return `schedule-session:${assignmentId}:${startsAt}`;
}

async function listActiveWindowAssignments(supabase: SupabaseLike, now: Date, limit: number) {
  const nowIso = now.toISOString();
  const result = await query(supabase, "account_assignments")
    .select("id,account_id,device_id,app_instance_id,starts_at,ends_at,status,schedule_mode,assignment_type")
    .in("status", ["reserved", "active"])
    .eq("schedule_mode", "scheduled")
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(limit) as QueryResult;

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
    .select("device_id,status,last_seen_at")
    .in("device_id", deviceIds)
    .limit(deviceIds.length) as QueryResult;
  if (result.error) throw new Error(result.error.message || "device_heartbeats_unavailable");
  const map = new Map<string, Record<string, unknown>>();
  for (const row of readRows(result.data)) {
    const deviceId = readString(row.device_id);
    if (deviceId && !map.has(deviceId)) map.set(deviceId, row);
  }
  return map;
}

async function listPeerAssignments(supabase: SupabaseLike, deviceIds: string[]) {
  if (!deviceIds.length) return [];
  const result = await query(supabase, "account_assignments")
    .select("account_id,device_id,app_instance_id,status,schedule_mode")
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

async function queueScheduledSession(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    startsAt: string;
    endsAt: string;
    workerId: string;
    deviceTimezone: string | null;
  },
) {
  const { data, error } = await supabase.rpc("create_account_run_request", {
    p_account_id: input.accountId,
    p_requested_by: null,
    p_actor_type: "system",
    p_source_surface: "instagram_schedule_session_cron",
    p_requested_run_type: "account_session",
    p_idempotency_key: scheduleSessionIdempotencyKey(input.assignmentId, input.startsAt),
    p_priority: 0,
    p_metadata_safe: {
      source: "schedule_session_cron",
      trigger: "scheduler",
      assignment_id: input.assignmentId,
      worker_id: input.workerId,
      scheduled_session_at: input.startsAt,
      scheduled_session_ends_at: input.endsAt,
      device_timezone: input.deviceTimezone,
    },
  });
  if (error) throw new Error(error.message || "schedule_session_enqueue_failed");
  return data;
}

export type ScheduleSessionEligibilityEvaluator = (
  accountId: string,
) => Promise<{ ok: true } | { ok: false; reason: string }>;

const defaultEligibilityEvaluator: ScheduleSessionEligibilityEvaluator = async (accountId) => {
  const { evaluateRunStartEligibility } = await import("./run-control.ts");
  const result = await evaluateRunStartEligibility(accountId, "account_session", { trigger: "scheduler" });
  if (result.ok) return { ok: true };
  return { ok: false, reason: result.reason };
};

export async function runScheduleSessionCron(
  supabase: SupabaseLike,
  options: {
    callerToken?: string | null;
    env?: Record<string, string | undefined>;
    now?: Date;
    evaluateEligibility?: ScheduleSessionEligibilityEvaluator;
  } = {},
): Promise<{ status: 200 | 401 | 403 | 503; result: ScheduleSessionCronResult }> {
  const env = readScheduleSessionCronEnv(options.env);
  if (!env.configuredToken) return { status: 503, result: skippedResult(env, "cron_token_not_configured") };
  const callerToken = options.callerToken?.trim() ?? "";
  if (!callerToken) return { status: 401, result: skippedResult(env, "missing_caller_token") };
  if (!tokensMatch(env.configuredToken, callerToken)) return { status: 403, result: skippedResult(env, "invalid_caller_token") };
  if (!env.enabled) return { status: 200, result: skippedResult(env, "cron_disabled") };

  const now = options.now ?? new Date();
  const evaluateEligibility = options.evaluateEligibility ?? defaultEligibilityEvaluator;
  const assignments = await listActiveWindowAssignments(supabase, now, env.limit);
  const summary = emptySummary();
  summary.scanned_assignments_count = assignments.length;
  if (!assignments.length) return { status: 200, result: skippedResult(env, "no_active_windows", summary) };

  const deviceIds = [...new Set(assignments.map((row) => readString(row.device_id)).filter(Boolean))];
  const [devicesById, heartbeatsByDevice, peerAssignments] = await Promise.all([
    listDevices(supabase, deviceIds),
    listDeviceHeartbeats(supabase, deviceIds),
    listPeerAssignments(supabase, deviceIds),
  ]);
  const accountIds = [...new Set([
    ...assignments.map((row) => readString(row.account_id)).filter(Boolean),
    ...peerAssignments.map((row) => readString(row.account_id)).filter(Boolean),
  ])];
  const [activeRequests, activeRuns] = await Promise.all([
    listActiveRequests(supabase, accountIds),
    listActiveRuns(supabase, accountIds),
  ]);
  const activeRequestAccounts = new Set(activeRequests.map((row) => readString(row.account_id)).filter(Boolean));
  const activeRunAccounts = new Set(activeRuns.map((row) => readString(row.account_id)).filter(Boolean));
  const activeRequestKeys = new Set(activeRequests.map((row) => readString(row.idempotency_key)).filter(Boolean));

  for (const assignment of assignments) {
    const assignmentId = readString(assignment.id, readString(assignment.assignment_id));
    const accountId = readString(assignment.account_id);
    const deviceId = readString(assignment.device_id);
    const startsAt = readString(assignment.starts_at);
    const endsAt = readString(assignment.ends_at);
    const scheduleMode = readString(assignment.schedule_mode, "scheduled");

    if (!assignmentId || !accountId || !deviceId || !startsAt || !endsAt) {
      summary.skipped_missing_assignment_target_count += 1;
      continue;
    }
    if (scheduleMode !== "scheduled") {
      summary.skipped_manual_only_count += 1;
      continue;
    }
    if (!assignmentWindowActive(startsAt, endsAt, now)) {
      summary.skipped_outside_window_count += 1;
      continue;
    }

    const device = devicesById.get(deviceId);
    if (!device || isEmulatorDevice(device) || !isPhysicalPhoneDevice(device)) {
      summary.skipped_emulator_device_count += 1;
      continue;
    }
    const heartbeat = heartbeatsByDevice.get(deviceId);
    if (!isAssignmentHeartbeatLive(heartbeat, now)) {
      summary.skipped_stale_device_count += 1;
      continue;
    }

    const idempotencyKey = scheduleSessionIdempotencyKey(assignmentId, startsAt);
    if (activeRequestKeys.has(idempotencyKey)) {
      summary.skipped_duplicate_slot_count += 1;
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
      .filter((row) => readString(row.device_id) === deviceId)
      .map((row) => readString(row.account_id))
      .filter(Boolean);
    if (busyPeerAccounts.some((peerAccountId) => activeRequestAccounts.has(peerAccountId) || activeRunAccounts.has(peerAccountId))) {
      summary.skipped_phone_busy_count += 1;
      continue;
    }

    const eligibility = await evaluateEligibility(accountId);
    if (!eligibility.ok) {
      summary.skipped_eligibility_count += 1;
      continue;
    }

    summary.eligible_count += 1;
    if (!env.dryRun) {
      await queueScheduledSession(supabase, {
        accountId,
        assignmentId,
        startsAt,
        endsAt,
        workerId: env.workerId,
        deviceTimezone: readString(device.timezone, "") || null,
      });
      summary.queued_count += 1;
      activeRequestKeys.add(idempotencyKey);
      activeRequestAccounts.add(accountId);
    }
  }

  return {
    status: 200,
    result: {
      enabled: true,
      dry_run: env.dryRun,
      worker_id: env.workerId,
      skipped: summary.eligible_count === 0,
      reason: summary.eligible_count === 0 ? "no_eligible_accounts" : null,
      summary,
    },
  };
}

export const SCHEDULE_SESSION_CRON_HEARTBEAT_STALE_MS = ASSIGNMENT_HEARTBEAT_STALE_MS;
