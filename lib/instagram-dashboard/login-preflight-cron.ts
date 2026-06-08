import { timingSafeEqual } from "node:crypto";

export type LoginPreflightCronReason =
  | "cron_disabled"
  | "cron_token_not_configured"
  | "missing_caller_token"
  | "invalid_caller_token"
  | "no_assignments"
  | "no_eligible_accounts";

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
  skipped_connected_count: number;
  skipped_active_request_count: number;
  skipped_active_run_count: number;
  skipped_missing_assignment_target_count: number;
  skipped_duplicate_preflight_count: number;
  skipped_phone_busy_count: number;
  skipped_deadline_too_close_count: number;
  dashboard_action_count: number;
};

export type LoginPreflightCronResult = {
  enabled: boolean;
  dry_run: boolean;
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
    skipped_connected_count: 0,
    skipped_active_request_count: 0,
    skipped_active_run_count: 0,
    skipped_missing_assignment_target_count: 0,
    skipped_duplicate_preflight_count: 0,
    skipped_phone_busy_count: 0,
    skipped_deadline_too_close_count: 0,
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
  return {
    enabled: readEnvBoolean(env.INSTAGRAM_LOGIN_PREFLIGHT_CRON_ENABLED, false),
    dryRun: readEnvBoolean(env.INSTAGRAM_LOGIN_PREFLIGHT_CRON_DRY_RUN, true),
    configuredToken: env.INSTAGRAM_LOGIN_PREFLIGHT_CRON_TOKEN?.trim() || null,
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

function skippedResult(env: LoginPreflightCronEnv, reason: LoginPreflightCronReason, summary = emptySummary()): LoginPreflightCronResult {
  return {
    enabled: env.enabled,
    dry_run: env.dryRun,
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

function preflightIdempotencyKey(assignmentId: string, phase: string) {
  return `login-preflight:${assignmentId}:${phase}`;
}

function deadlineAt(startsAt: string, env: LoginPreflightCronEnv) {
  const starts = new Date(startsAt).getTime();
  if (!Number.isFinite(starts)) return null;
  return new Date(starts - env.deadlineSafetySeconds * 1000);
}

function hasEnoughRunway(startsAt: string, now: Date, env: LoginPreflightCronEnv) {
  const deadline = deadlineAt(startsAt, env);
  if (!deadline) return false;
  return now.getTime() + env.expectedDurationMinutes * 60_000 < deadline.getTime();
}

async function listUpcomingAssignments(supabase: SupabaseLike, now: Date, env: LoginPreflightCronEnv) {
  const result = await query(supabase, "account_assignments")
    .select("id,account_id,device_id,app_instance_id,starts_at,ends_at,status")
    .in("status", ["reserved", "active"])
    .gte("starts_at", addMinutes(now, 0).toISOString())
    .lte("starts_at", addMinutes(now, env.t10WindowMinutes).toISOString())
    .order("starts_at", { ascending: true })
    .limit(env.limit) as QueryResult;

  if (result.error) throw new Error(result.error.message || "assignments_unavailable");
  return readRows(result.data);
}

async function listClientStatuses(supabase: SupabaseLike, accountIds: string[]) {
  if (!accountIds.length) return new Map<string, Record<string, unknown>>();
  const result = await query(supabase, "client_instagram_accounts")
    .select("account_id,login_status,provisioning_status,onboarding_status")
    .in("account_id", accountIds)
    .limit(accountIds.length) as QueryResult;
  if (result.error) throw new Error(result.error.message || "client_status_unavailable");
  return new Map(readRows(result.data).map((row) => [readString(row.account_id), row]));
}

async function listPeerAssignments(supabase: SupabaseLike, deviceIds: string[], appInstanceIds: string[]) {
  const queries: Array<Promise<QueryResult>> = [];
  if (deviceIds.length) {
    queries.push(query(supabase, "account_assignments")
      .select("account_id,device_id,app_instance_id,status")
      .in("status", ["reserved", "active"])
      .in("device_id", deviceIds)
      .limit(500) as Promise<QueryResult>);
  }
  if (appInstanceIds.length) {
    queries.push(query(supabase, "account_assignments")
      .select("account_id,device_id,app_instance_id,status")
      .in("status", ["reserved", "active"])
      .in("app_instance_id", appInstanceIds)
      .limit(500) as Promise<QueryResult>);
  }
  if (!queries.length) return [];
  const results = await Promise.all(queries);
  const rows: Record<string, unknown>[] = [];
  for (const result of results) {
    if (result.error) throw new Error(result.error.message || "peer_assignments_unavailable");
    rows.push(...readRows(result.data));
  }
  return rows;
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

function isConnected(row: Record<string, unknown> | undefined) {
  return readString(row?.login_status).toLowerCase() === "connected"
    && readString(row?.provisioning_status).toLowerCase() === "ready";
}

async function queueLoginPreflight(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    assignmentId: string;
    startsAt: string;
    endsAt: string;
    phase: string;
    workerId: string;
    deadlineAt: string;
  },
) {
  const { data, error } = await supabase.rpc("create_account_run_request", {
    p_account_id: input.accountId,
    p_requested_by: null,
    p_actor_type: "system",
    p_source_surface: "instagram_login_preflight_cron",
    p_requested_run_type: "login_provisioning",
    p_idempotency_key: preflightIdempotencyKey(input.assignmentId, input.phase),
    p_priority: input.phase === "t5" ? 5 : 1,
    p_metadata_safe: {
      source: "login_preflight_cron",
      assignment_id: input.assignmentId,
      phase: input.phase,
      worker_id: input.workerId,
      scheduled_session_at: input.startsAt,
      scheduled_session_ends_at: input.endsAt,
      deadline_at: input.deadlineAt,
    },
  });
  if (error) throw new Error(error.message || "login_preflight_enqueue_failed");
  return data;
}

async function upsertLoginAction(supabase: SupabaseLike, input: { accountId: string; assignmentId: string; startsAt: string; phase: string }) {
  await supabase.rpc("upsert_account_dashboard_action", {
    p_account_id: input.accountId,
    p_client_id: null,
    p_incident_id: null,
    p_action_type: "login_preflight_scheduled",
    p_status: "pending",
    p_title: "Auto-login preflight scheduled",
    p_dedupe_key: `account:${input.accountId}:login_preflight:${input.assignmentId}:${input.phase}`,
    p_safe_client_message: "Instagram login readiness is being checked before the next scheduled session.",
    p_admin_message: "Login preflight request was queued before the next scheduled session.",
    p_assistant_message: null,
    p_action_label: "Monitor",
    p_action_deep_link: "/instagram-dashboard/credentials-actions",
    p_severity: "info",
    p_audience: "admin",
    p_requires_client_action: false,
    p_blocking_campaign: false,
    p_metadata: {
      source: "login_preflight_cron",
      assignment_id: input.assignmentId,
      phase: input.phase,
      scheduled_session_at: input.startsAt,
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
  const assignments = await listUpcomingAssignments(supabase, now, env);
  const summary = emptySummary();
  summary.scanned_assignments_count = assignments.length;
  if (!assignments.length) return { status: 200, result: skippedResult(env, "no_assignments", summary) };

  const candidateDeviceIds = [...new Set(assignments.map((row) => readString(row.device_id)).filter(Boolean))];
  const candidateAppInstanceIds = [...new Set(assignments.map((row) => readString(row.app_instance_id)).filter(Boolean))];
  const peerAssignments = await listPeerAssignments(supabase, candidateDeviceIds, candidateAppInstanceIds);
  const accountIds = [...new Set([
    ...assignments.map((row) => readString(row.account_id)).filter(Boolean),
    ...peerAssignments.map((row) => readString(row.account_id)).filter(Boolean),
  ])];
  const [statusesByAccount, activeRequests, activeRuns] = await Promise.all([
    listClientStatuses(supabase, accountIds),
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
    const appInstanceId = readString(assignment.app_instance_id);
    const startsAt = readString(assignment.starts_at);
    const endsAt = readString(assignment.ends_at);
    if (!assignmentId || !accountId || !deviceId || !appInstanceId || !startsAt || !endsAt) {
      summary.skipped_missing_assignment_target_count += 1;
      continue;
    }
    const phase = preflightPhase(startsAt, now, env);
    const idempotencyKey = preflightIdempotencyKey(assignmentId, phase);
    if (isConnected(statusesByAccount.get(accountId))) {
      summary.skipped_connected_count += 1;
      continue;
    }
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
    const deadline = deadlineAt(startsAt, env);
    if (!deadline || !hasEnoughRunway(startsAt, now, env)) {
      summary.skipped_deadline_too_close_count += 1;
      continue;
    }

    summary.eligible_count += 1;
    if (!env.dryRun) {
      await queueLoginPreflight(supabase, {
        accountId,
        assignmentId,
        startsAt,
        endsAt,
        phase,
        workerId: env.workerId,
        deadlineAt: deadline.toISOString(),
      });
      summary.queued_count += 1;
      await upsertLoginAction(supabase, { accountId, assignmentId, startsAt, phase });
      summary.dashboard_action_count += 1;
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
