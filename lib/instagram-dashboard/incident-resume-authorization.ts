/**
 * P3 — human-confirmed resume authorizations ("Prêt à relancer").
 *
 * Contract:
 *  - the operator arms ONE durable, audited authorization on a
 *    recovery-eligible incident (never creates a run, never forces a tick);
 *  - Auto Restart is the only consumer: it claims the authorization
 *    atomically (armed -> consumed) before creating exactly one resume
 *    request in the same active window;
 *  - a consumed/expired authorization can never be re-armed for the same
 *    window (DB partial unique index): 1 click -> max 1 resume -> 1 window.
 *
 * Stable reasons (CP1 style):
 *  awaiting_human_resume_authorization, resume_authorization_expired,
 *  resume_authorization_consumed, resume_retry_window_exhausted,
 *  resume_plan_not_recoverable, resume_window_closed, resume_plan_missing.
 */

export const READY_TO_RESUME_ACTION = "ready_to_resume";

/** Incident types eligible for the human-confirmed resume flow. */
export const RECOVERY_ELIGIBLE_INCIDENT_TYPES = new Set([
  "run_identity_verification_failed",
  "active_instagram_account_mismatch",
  "account_login_required",
  "assigned_instagram_package_unavailable",
  "run_device_unavailable",
  "run_worker_failure",
  "instagram_account_restriction",
]);

export type RecoveryState =
  | "none"
  | "awaiting_human_resume_authorization"
  | "ready_to_resume"
  | "resume_requested"
  | "reintervention_required"
  | "resume_succeeded"
  | "resume_authorization_expired";

export interface RecoveryView {
  state: RecoveryState;
  eligible: boolean;
  reason: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  windowActive: boolean;
  resumePlanId: string | null;
  authorizationId: string | null;
  authorizationStatus: string | null;
}

type SupabaseLike = {
  from: (table: string) => unknown;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  insert: (...args: unknown[]) => QueryBuilder & PromiseLike<QueryResult>;
  update: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => Promise<QueryResult>;
  limit: (...args: unknown[]) => Promise<QueryResult> & QueryBuilder;
};

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function windowContainsNow(
  startsAt: string | null,
  endsAt: string | null,
  now = new Date(),
): boolean {
  if (!startsAt || !endsAt) return false;
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const ts = now.getTime();
  return start <= ts && ts < end;
}

export function readIncidentRecoveryState(metadata: unknown): RecoveryState {
  const recovery = readRecord(readRecord(metadata).recovery);
  const state = readString(recovery.state);
  const known: RecoveryState[] = [
    "awaiting_human_resume_authorization",
    "ready_to_resume",
    "resume_requested",
    "reintervention_required",
    "resume_succeeded",
    "resume_authorization_expired",
  ];
  return (known as string[]).includes(state) ? (state as RecoveryState) : "none";
}

export async function loadResumePlanForRun(
  supabase: SupabaseLike,
  runId: string,
): Promise<Record<string, unknown> | null> {
  const result = await query(supabase, "account_session_resume_plans")
    .select(
      "id,run_id,run_request_id,account_id,assignment_id,device_id,app_instance_id,resume_window_key,scheduled_window_start,scheduled_window_end,resume_stage,resume_state,restart_allowed,restart_block_reason,terminal_reason_code,attempts_in_window,plan,test",
    )
    .eq("run_id", runId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "resume_plan_read_failed");
  return (result.data as Record<string, unknown> | null) ?? null;
}

export async function loadAuthorizationForIncident(
  supabase: SupabaseLike,
  incidentId: string,
): Promise<Record<string, unknown> | null> {
  const result = await query(supabase, "incident_resume_authorizations")
    .select("id,incident_id,account_id,run_id,resume_plan_id,resume_window_key,scheduled_window_start,scheduled_window_end,status,armed_at,consumed_at,consumed_by_request_id,expired_at,test")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false })
    .limit(1) as unknown as Promise<QueryResult>;
  const { data, error } = await result;
  if (error) throw new Error(error.message || "resume_authorization_read_failed");
  const rows = Array.isArray(data) ? data : [];
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * Evaluate whether the "Prêt à relancer" action is currently available for
 * one incident row, with a stable, safe reason when it is not.
 */
export async function evaluateReadyToResume(
  supabase: SupabaseLike,
  incidentRow: Record<string, unknown>,
  now = new Date(),
): Promise<RecoveryView> {
  const incidentId = readString(incidentRow.id);
  const accountId = readString(incidentRow.account_id);
  const runId = readString(incidentRow.run_id);
  const status = readString(incidentRow.status).toLowerCase();
  const incidentType = readString(incidentRow.incident_type);
  const metadataState = readIncidentRecoveryState(incidentRow.metadata);

  const base: RecoveryView = {
    state: metadataState,
    eligible: false,
    reason: null,
    windowStart: null,
    windowEnd: null,
    windowActive: false,
    resumePlanId: null,
    authorizationId: null,
    authorizationStatus: null,
  };

  if (!incidentId || !accountId || !runId) {
    return { ...base, reason: "resume_plan_missing" };
  }
  if (!RECOVERY_ELIGIBLE_INCIDENT_TYPES.has(incidentType)) {
    return { ...base, reason: "resume_plan_not_recoverable" };
  }
  if (status !== "open" && status !== "acknowledged") {
    return { ...base, reason: "incident_not_active" };
  }

  const plan = await loadResumePlanForRun(supabase, runId);
  if (!plan) {
    return { ...base, reason: "resume_plan_missing" };
  }
  const planState = readString(plan.resume_state);
  const windowStart = readString(plan.scheduled_window_start) || null;
  const windowEnd = readString(plan.scheduled_window_end) || null;
  const windowActive = windowContainsNow(windowStart, windowEnd, now);
  const enriched: RecoveryView = {
    ...base,
    windowStart,
    windowEnd,
    windowActive,
    resumePlanId: readString(plan.id) || null,
  };

  const authorization = await loadAuthorizationForIncident(supabase, incidentId);
  if (authorization) {
    enriched.authorizationId = readString(authorization.id) || null;
    enriched.authorizationStatus = readString(authorization.status) || null;
    const authStatus = readString(authorization.status);
    if (authStatus === "armed") {
      return {
        ...enriched,
        state: "ready_to_resume",
        reason: "awaiting_next_scheduler_tick",
      };
    }
    if (authStatus === "consumed") {
      // Budget already used for this window: no re-arm, no loop.
      const state: RecoveryState =
        metadataState === "resume_requested" || metadataState === "resume_succeeded"
          ? metadataState
          : "reintervention_required";
      return { ...enriched, state, reason: "resume_retry_window_exhausted" };
    }
    if (authStatus === "expired") {
      return {
        ...enriched,
        state: "resume_authorization_expired",
        reason: "resume_authorization_expired",
      };
    }
  }

  if (planState === "resume_succeeded" || planState === "completed") {
    return { ...enriched, reason: "resume_plan_not_recoverable" };
  }
  if (planState !== "awaiting_human_resume_authorization") {
    return { ...enriched, reason: "resume_plan_not_recoverable" };
  }
  if (!windowActive) {
    return { ...enriched, reason: "resume_window_closed" };
  }

  return {
    ...enriched,
    state: "awaiting_human_resume_authorization",
    eligible: true,
    reason: null,
  };
}

export interface ArmResult {
  ok: boolean;
  reason: string;
  authorizationId: string | null;
  state: RecoveryState;
}

/**
 * Arm one durable authorization for a recovery-eligible incident.
 * Never creates a run, never forces a tick, never contacts a worker.
 */
export async function armReadyToResume(
  supabase: SupabaseLike,
  input: {
    incidentRow: Record<string, unknown>;
    armedBy?: string | null;
    armedSource?: string;
    resolutionNote?: string;
    now?: Date;
  },
): Promise<ArmResult> {
  const now = input.now ?? new Date();
  const incidentRow = input.incidentRow;
  const incidentId = readString(incidentRow.id);
  const view = await evaluateReadyToResume(supabase, incidentRow, now);
  if (!view.eligible) {
    return {
      ok: false,
      reason: view.reason || "resume_plan_not_recoverable",
      authorizationId: view.authorizationId,
      state: view.state,
    };
  }

  const plan = await loadResumePlanForRun(supabase, readString(incidentRow.run_id));
  const resumeWindowKey = readString(plan?.resume_window_key)
    || `${readString(incidentRow.account_id)}:${view.windowStart ?? ""}`;
  const isTest = readRecord(incidentRow.metadata).test === true
    || readString(incidentRow.incident_type) === "system_test_incident"
    || plan?.test === true;

  const insert = await (query(supabase, "incident_resume_authorizations")
    .insert({
      incident_id: incidentId,
      account_id: readString(incidentRow.account_id),
      run_id: readString(incidentRow.run_id) || null,
      resume_plan_id: view.resumePlanId,
      resume_window_key: resumeWindowKey,
      scheduled_window_start: view.windowStart,
      scheduled_window_end: view.windowEnd,
      status: "armed",
      armed_source: input.armedSource || "botapp_relay",
      armed_by: input.armedBy || null,
      resolution_note: (input.resolutionNote || "").slice(0, 500) || null,
      metadata_safe: {
        incident_type: readString(incidentRow.incident_type),
        reason_code: readString(incidentRow.reason) || readString(incidentRow.failure_reason),
      },
      test: isTest,
    })
    .select("id") as unknown as QueryBuilder)
    .maybeSingle();

  if (insert.error) {
    const message = (insert.error.message || "").toLowerCase();
    if (message.includes("duplicate") || message.includes("unique")) {
      // Concurrent click or window budget already used: stable reason, no loop.
      const existing = await loadAuthorizationForIncident(supabase, incidentId);
      const existingStatus = readString(existing?.status);
      return {
        ok: false,
        reason:
          existingStatus === "armed"
            ? "resume_authorization_already_armed"
            : "resume_retry_window_exhausted",
        authorizationId: readString(existing?.id) || null,
        state: existingStatus === "armed" ? "ready_to_resume" : "reintervention_required",
      };
    }
    throw new Error(insert.error.message || "resume_authorization_arm_failed");
  }

  const authorizationId = readString(readRecord(insert.data).id) || null;
  return {
    ok: true,
    reason: "armed",
    authorizationId,
    state: "ready_to_resume",
  };
}

/**
 * Atomically claim one armed authorization (Auto Restart tick only).
 * Returns false when another tick already consumed it.
 */
export async function claimAuthorizationAtomically(
  supabase: SupabaseLike,
  authorizationId: string,
  now = new Date(),
): Promise<boolean> {
  const result = await (query(supabase, "incident_resume_authorizations")
    .update({
      status: "consumed",
      consumed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", authorizationId)
    .eq("status", "armed")
    .select("id") as unknown as QueryBuilder)
    .limit(1) as unknown as Promise<QueryResult>;
  const { data, error } = await result;
  if (error) throw new Error(error.message || "resume_authorization_claim_failed");
  return Array.isArray(data) && data.length > 0;
}

export async function markAuthorizationExpired(
  supabase: SupabaseLike,
  authorizationId: string,
  now = new Date(),
): Promise<void> {
  await (query(supabase, "incident_resume_authorizations")
    .update({
      status: "expired",
      expired_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", authorizationId)
    .eq("status", "armed") as unknown as QueryBuilder)
    .select("id")
    .limit(1);
}

export async function bindAuthorizationToRequest(
  supabase: SupabaseLike,
  authorizationId: string,
  requestId: string | null,
  consumeError?: string,
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (requestId) update.consumed_by_request_id = requestId;
  if (consumeError) update.consume_error = consumeError.slice(0, 300);
  await (query(supabase, "incident_resume_authorizations")
    .update(update)
    .eq("id", authorizationId) as unknown as QueryBuilder)
    .select("id")
    .limit(1);
}

/** Merge the recovery state block into one incident's metadata (audited). */
export async function updateIncidentRecoveryState(
  supabase: SupabaseLike,
  incidentId: string,
  state: RecoveryState | string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const read = await query(supabase, "account_incidents")
    .select("id,metadata")
    .eq("id", incidentId)
    .maybeSingle();
  if (read.error || !read.data) return;
  const metadata = readRecord(readRecord(read.data).metadata);
  const recovery = readRecord(metadata.recovery);
  const nowIso = new Date().toISOString();
  const nextMetadata = {
    ...metadata,
    recovery: { ...recovery, state, updated_at: nowIso, ...extra },
  };
  await (query(supabase, "account_incidents")
    .update({ metadata: nextMetadata, updated_at: nowIso })
    .eq("id", incidentId) as unknown as QueryBuilder)
    .select("id")
    .limit(1);
}

/** Set the resume plan state (worker claim validation reads this). */
export async function setResumePlanState(
  supabase: SupabaseLike,
  resumePlanId: string,
  resumeState: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await (query(supabase, "account_session_resume_plans")
    .update({
      resume_state: resumeState,
      last_updated_at: new Date().toISOString(),
      ...extra,
    })
    .eq("id", resumePlanId) as unknown as QueryBuilder)
    .select("id")
    .limit(1);
}
