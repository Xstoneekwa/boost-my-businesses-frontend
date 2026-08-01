import { getAutoRestartData, rulesFromSettingsRow, type AutoRestartCandidate, type AutoRestartMode, type AutoRestartRulePreview } from "@/app/instagram-dashboard/auto-restart-data";
import type { SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import {
  AUTO_RESTART_TICK_SOURCE,
  AUTO_RESTART_TICK_TOKEN_HEADER,
  autoRestartEnqueueIdempotencyKey,
  autoRestartTickIdempotencyKey,
  autoRestartTickLockBucketStart,
  passesRiskPolicy,
  resumePlanRuntimeEvidence,
  unfollowDecisionNextEvaluationAt,
  resumePlanRuntimeSupported,
  sastBusinessDay,
  sanitizeTickFailureReason,
  sameSastBusinessDay,
  schedulerTickGate,
} from "./auto-restart-tick-helpers";
import {
  acquireDeviceSessionLock,
  bindDeviceSessionLockToRequest,
  releaseDeviceSessionLock,
} from "@/lib/instagram-dashboard/device-session-lock";
import {
  assertTrustedDispatcherIdentity,
  isRunDispatcherWorkerId,
  MANUAL_RESTART_AUDIT_ACTOR,
  resolveTrustedDispatcherWorkerForPhoneDevice,
} from "@/lib/instagram-dashboard/dispatcher-trust";

export {
  AUTO_RESTART_TICK_TOKEN_HEADER,
  autoRestartEnqueueIdempotencyKey,
  autoRestartTickIdempotencyKey,
  resumePlanRuntimeSupported,
} from "./auto-restart-tick-helpers";

export { assertTrustedDispatcherWorkerId } from "./dispatcher-trust";
import {
  applyFollow60sOneShotFrozenPlan,
  buildAutoRestartResumePlanMetadata,
  buildInstagramRestrictionPreflightMetadata,
  rebuildResolvedIncidentResumeCandidate,
  validateCanonicalResumePlan,
} from "./auto-restart-resume-metadata";
import {
  attachArmedFollow60Contract,
  projectArmedFollow60Candidate,
  resolveArmedFollow60Control,
  type Follow60ControlRow,
} from "./auto-restart-follow60-armed-control";
import { maxRetriesBlockReason, restartDelayBlockReason } from "./auto-restart-operational";
import {
  authoritativeDelayRemainingSeconds,
  buildUnfollowResumeNotificationPayload,
  resumeLineageBudgetKey,
  resumePhaseKey,
  resumeReasonKey,
  validateResumeAuthorizationLineage,
} from "./auto-restart-lineage-policy";
import {
  loadResumePlanForRun,
  markAuthorizationExpired,
  updateIncidentRecoveryState,
  windowContainsNow,
} from "./incident-resume-authorization";

export async function getAutoRestartTickStatus(supabase: SupabaseLike) {
  const settingsRow = await loadSettingsRow(supabase);
  const rules = rulesFromSettingsRow(settingsRow ?? undefined);
  return {
    read_only: true,
    enabled: rules.enabled,
    mode: rules.mode,
    check_every_minutes: Math.max(1, readNumber(settingsRow?.check_every_minutes, rules.checkEveryMinutes || 15)),
    enqueue_endpoint: "POST",
  };
}

type SupabaseLike = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: { message?: string } | null }>;
};

type QueryResult = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  gte: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  insert: (...args: unknown[]) => Promise<QueryResult>;
  upsert: (...args: unknown[]) => Promise<QueryResult>;
  update: (...args: unknown[]) => QueryBuilder;
  delete: (...args: unknown[]) => QueryBuilder;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
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

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

const ENQUEUE_ACTIVE_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running"]);

function query(supabase: SupabaseLike, table: string): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function readEnvBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

export function extractAutoRestartTickToken(request: Request) {
  return request.headers.get(AUTO_RESTART_TICK_TOKEN_HEADER)?.trim()
    || new URL(request.url).searchParams.get("token")?.trim()
    || "";
}

export function readAutoRestartTickEnv(env: Record<string, string | undefined> = process.env) {
  return {
    configuredToken: env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN?.trim() || null,
    deviceLockLeaseSeconds: Math.min(3600, Math.max(60, Number(env.INSTAGRAM_AUTO_RESTART_DEVICE_LOCK_SECONDS || 900) || 900)),
  };
}

function todayStartIso(now = new Date()) {
  // South Africa has no DST. Count the daily restart budget from the actual
  // SAST business-day boundary rather than UTC midnight.
  return `${sastBusinessDay(now)}T00:00:00.000+02:00`;
}

async function loadSettingsRow(supabase: SupabaseLike) {
  const result = await query(supabase, "auto_restart_settings")
    .select("*")
    .eq("id", "global")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "auto_restart_settings_unavailable");
  return (result.data ?? null) as SupabaseRecord | null;
}

async function loadRestartCounts(supabase: SupabaseLike, sinceIso: string) {
  const result = await query(supabase, "auto_restart_decisions")
    .select("account_id,business_session_id,prior_run_id,metadata_safe")
    .eq("decision", "enqueued")
    .gte("created_at", sinceIso)
    .limit(10000);
  if (result.error) throw new Error(result.error.message || "auto_restart_decisions_unavailable");
  const rows = readRows(result.data);
  if (rows.length >= 10000) throw new Error("auto_restart_count_projection_truncated");
  const byAccount = new Map<string, number>();
  const byBusinessSession = new Map<string, number>();
  const byPhase = new Map<string, number>();
  const byReason = new Map<string, number>();
  const byLineage = new Map<string, number>();
  const bySourceRun = new Map<string, number>();
  for (const row of rows) {
    const accountId = readString(row.account_id);
    const businessSessionId = readString(row.business_session_id);
    const priorRunId = readString(row.prior_run_id);
    const metadata = row.metadata_safe && typeof row.metadata_safe === "object" && !Array.isArray(row.metadata_safe)
      ? row.metadata_safe as Record<string, unknown>
      : {};
    const phaseKey = readString(metadata.resume_phase_key);
    const reasonKey = readString(metadata.resume_reason_key);
    const lineageKey = readString(metadata.resume_lineage_key);
    if (accountId) {
      byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + 1);
    }
    if (accountId && businessSessionId) {
      const key = `${accountId}:${businessSessionId}`;
      byBusinessSession.set(key, (byBusinessSession.get(key) ?? 0) + 1);
    }
    if (accountId && phaseKey) {
      const key = `${accountId}:${phaseKey}`;
      byPhase.set(key, (byPhase.get(key) ?? 0) + 1);
    }
    if (accountId && reasonKey) {
      const key = `${accountId}:${reasonKey}`;
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    if (lineageKey) {
      byLineage.set(lineageKey, (byLineage.get(lineageKey) ?? 0) + 1);
    }
    // Decisions created before the structured lineage metadata was deployed
    // still carry prior_run_id. Keep those durable rows authoritative so a
    // deployment cannot reset a source-run budget mid business day.
    if (accountId && priorRunId) {
      const key = `${accountId}:${priorRunId}`;
      bySourceRun.set(key, (bySourceRun.get(key) ?? 0) + 1);
    }
  }
  return { byAccount, byBusinessSession, byPhase, byReason, byLineage, bySourceRun };
}

async function acquireTickLock(
  supabase: SupabaseLike,
  input: { idempotencyKey: string; workerId: string; metadata: Record<string, unknown> },
) {
  const existing = await query(supabase, "auto_restart_tick_locks")
    .select("idempotency_key,status")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message || "tick_lock_read_failed");
  if (existing.data) {
    return { acquired: false, reason: "auto_restart_enqueue_deduplicated" as const };
  }
  const insert = await (supabase.from("auto_restart_tick_locks") as QueryBuilder).insert({
      idempotency_key: input.idempotencyKey,
      worker_id: input.workerId,
      status: "started",
      metadata_safe: input.metadata,
    }) as unknown as QueryResult;
  if (insert.error) {
    return { acquired: false, reason: "auto_restart_enqueue_deduplicated" as const };
  }
  return { acquired: true, reason: "" as const };
}

async function completeTickLock(
  supabase: SupabaseLike,
  idempotencyKey: string,
  status: "completed" | "failed",
  failure?: { reason: string },
  completion?: Record<string, unknown>,
) {
  const update: Record<string, unknown> = {
    status,
    tick_completed_at: new Date().toISOString(),
  };
  if ((status === "failed" && failure) || completion) {
    // Preserve acquisition metadata and append bounded completion evidence.
    const existing = await query(supabase, "auto_restart_tick_locks")
      .select("metadata_safe")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const currentMetadata = existing.data && typeof existing.data === "object"
      ? ((existing.data as Record<string, unknown>).metadata_safe ?? {})
      : {};
    update.metadata_safe = {
      ...(currentMetadata && typeof currentMetadata === "object" && !Array.isArray(currentMetadata) ? currentMetadata : {}),
      ...(failure ? { failure_reason: failure.reason } : {}),
      ...(completion ?? {}),
    };
  }
  await query(supabase, "auto_restart_tick_locks")
    .update(update)
    .eq("idempotency_key", idempotencyKey);
}

/**
 * Finalizes a held tick lock as failed after an unexpected exception, with a
 * redacted stable reason. Best-effort: finalization must never mask the
 * original error, and the bucket-based idempotency key guarantees the next
 * tick bucket stays runnable even if this update itself fails.
 */
async function failTickLock(supabase: SupabaseLike, idempotencyKey: string, error: unknown) {
  try {
    await completeTickLock(supabase, idempotencyKey, "failed", {
      reason: sanitizeTickFailureReason(error),
    });
  } catch {
    // Swallow: the original tick error is the signal that matters.
  }
}

async function writeDecision(
  supabase: SupabaseLike,
  input: {
    requestId: string;
    idempotencyKey: string;
    actor: string;
    accountId: string | null;
    deviceId: string | null;
    action: string;
    decision: string;
    reason: string;
    mode: AutoRestartMode;
    metadata?: Record<string, unknown>;
    priorRunId?: string | null;
    newRequestId?: string | null;
    restartCountDay?: number;
    restartCountWindow?: number;
    businessSessionId?: string | null;
  },
) {
  const insert = await query(supabase, "auto_restart_decisions").insert({
    request_id: input.requestId,
    idempotency_key: input.idempotencyKey,
    actor: input.actor,
    account_id: input.accountId,
    device_id: input.deviceId,
    action: input.action,
    decision: input.decision,
    reason: input.reason,
    mode: input.mode,
    prior_run_id: input.priorRunId ?? null,
    business_session_id: input.businessSessionId ?? null,
    new_request_id: input.newRequestId ?? null,
    restart_count_day: input.restartCountDay ?? 0,
    restart_count_window: input.restartCountWindow ?? 0,
    metadata_safe: input.metadata ?? {},
  });
  if (insert.error && !insert.error.message?.toLowerCase().includes("duplicate")) {
    throw new Error(insert.error.message || "auto_restart_decision_write_failed");
  }
}

function candidateDecisionMetadata(
  candidate: AutoRestartCandidate,
  input: {
    enqueueAllowed: boolean;
    evaluatedAt: string;
    reason?: string;
    authorizationSource?: string | null;
  },
) {
  const resumePhase = resumePhaseKey(candidate.plannedPhasesToRun);
  const resumeReason = resumeReasonKey(candidate);
  const resumeLineage = resumeLineageBudgetKey(candidate);
  const decisionReason = input.reason || (input.enqueueAllowed ? "eligible" : candidate.blockReason || "blocked");
  return {
    ...resumePlanRuntimeEvidence(candidate),
    username: candidate.username,
    account_eligible: candidate.accountEligible,
    account_eligibility_reason: candidate.accountEligibilityReason,
    restart_needed: candidate.restartNeeded,
    restart_need_reason: candidate.restartNeedReason,
    exact_viewport_resume_available: candidate.exactViewportResumeAvailable,
    safe_restart_strategy: candidate.safeRestartStrategy,
    safe_restart_reason: candidate.safeRestartReason,
    historical_safe_boundary_fallback: candidate.historicalSafeBoundaryFallback,
    operator_stop_continuation: candidate.operatorStopContinuation,
    operator_stop_reason: candidate.operatorStopReason,
    fresh_boundary_only: candidate.freshBoundaryOnly,
    remaining_follow_quota: candidate.remainingFollowQuota,
    source_run_id: candidate.sourceRunId || null,
    source_request_id: candidate.sourceRequestId ?? null,
    canonical_attempt_id: candidate.canonicalAttemptId ?? null,
    canonical_attempt_source: candidate.reliability.attemptSource ?? null,
    attempt_projection_id: candidate.reliability.attemptProjectionId ?? null,
    attempt_projection_divergence: candidate.reliability.attemptProjectionDivergence === true,
    source_business_session_id: candidate.sourceBusinessSessionId || null,
    phase_status: candidate.reliability.unfollowPhaseStatus ?? null,
    session_target: candidate.reliability.unfollowSessionTarget ?? null,
    session_verified: candidate.reliability.unfollowSessionVerified ?? null,
    actionable_now: candidate.eligibleUnfollowCandidateCount ?? null,
    technical_hold_total: candidate.technicalHoldUnfollowCandidateCount ?? null,
    terminal_total: candidate.terminalUnfollowCandidateCount ?? null,
    remaining_total: candidate.unfollowBacklogTotal ?? null,
    next_retry_at: unfollowDecisionNextEvaluationAt(candidate),
    planned_resume_quota: candidate.plannedQuotaRemaining,
    restart_delay_remaining: authoritativeDelayRemainingSeconds(
      candidate.reliability.nextRestartAt,
      new Date(input.evaluatedAt),
    ),
    lineage_valid: candidate.sourceLineageValid === true,
    circuit_state: {
      open: candidate.unfollowPhaseCircuitOpen === true,
      reason: candidate.unfollowPhaseCircuitReason ?? null,
      next_retry_at: candidate.unfollowPhaseCircuitNextRetryAt ?? null,
    },
    final_reason: decisionReason,
    prior_target_id: candidate.priorTargetId,
    next_target_id: candidate.nextTargetId,
    enqueue_allowed: input.enqueueAllowed,
    evaluated_at: input.evaluatedAt,
    planned_run_type: candidate.plannedRunType,
    resume_phase_key: resumePhase,
    resume_reason_key: resumeReason,
    resume_lineage_key: resumeLineage,
    notification_payload: buildUnfollowResumeNotificationPayload({
      candidate,
      reason: decisionReason,
      evaluatedAt: input.evaluatedAt,
      authorizationSource: input.authorizationSource,
    }),
  };
}

async function writeBlockedCandidateDecision(
  supabase: SupabaseLike,
  input: {
    candidate: AutoRestartCandidate;
    requestId: string;
    idempotencyKey: string;
    actor: string;
    reason: string;
    mode: AutoRestartMode;
    evaluatedAt: string;
    deviceId?: string | null;
    restartCountDay?: number;
    restartCountWindow?: number;
  },
) {
  await writeDecision(supabase, {
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
    accountId: input.candidate.accountId,
    deviceId: input.deviceId ?? input.candidate.deviceId ?? null,
    action: "auto_restart_candidate_blocked",
    decision: "blocked",
    reason: input.reason,
    mode: input.mode,
    metadata: candidateDecisionMetadata(input.candidate, {
      enqueueAllowed: false,
      evaluatedAt: input.evaluatedAt,
      reason: input.reason,
    }),
    priorRunId: input.candidate.sourceRunId || null,
    restartCountDay: input.restartCountDay,
    restartCountWindow: input.restartCountWindow,
    businessSessionId: input.candidate.sourceBusinessSessionId || null,
  });
}

async function acquireDeviceLock(
  supabase: SupabaseLike,
  input: {
    deviceId: string;
    workerId: string;
    accountId: string;
    appInstanceId: string | null;
    leaseSeconds: number;
  },
) {
  return acquireDeviceSessionLock(supabase, {
    ...input,
    reason: "auto_restart",
  });
}

async function bindDeviceLockToRequest(
  supabase: SupabaseLike,
  input: { deviceId: string; workerId: string; requestId: string; leaseSeconds: number },
) {
  return bindDeviceSessionLockToRequest(supabase, input);
}

async function releaseDeviceLock(
  supabase: SupabaseLike,
  deviceId: string,
  workerId: string,
  requestId?: string | null,
) {
  await releaseDeviceSessionLock(supabase, { deviceId, workerId, requestId });
}

async function enqueueAutoRestartRequest(
  supabase: SupabaseLike,
  input: {
    accountId: string;
    workerId: string;
    idempotencyKey: string;
    runType: "account_session" | "outreach_session";
    metadata: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc("create_account_run_request", {
    p_account_id: input.accountId,
    p_requested_by: null,
    p_actor_type: "system",
    p_source_surface: AUTO_RESTART_TICK_SOURCE,
    p_requested_run_type: input.runType,
    p_idempotency_key: input.idempotencyKey,
    p_priority: 0,
    p_metadata_safe: input.metadata,
  });
  if (error) throw new Error(error.message || "auto_restart_enqueue_failed");
  return data;
}

async function consumeAuthorizationAndCreateRequest(
  supabase: SupabaseLike,
  input: {
    authorizationId: string;
    workerId: string;
    deviceId: string | null;
    metadata: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc("consume_resume_authorization_and_create_request_v3", {
    p_authorization_id: input.authorizationId,
    p_worker_id: input.workerId,
    p_device_id: input.deviceId,
    p_metadata_safe: input.metadata,
  });
  if (error) throw new Error(error.message || "resume_atomic_enqueue_failed");
  return data as Record<string, unknown> | null;
}

export type AutoRestartTickSummary = {
  tick_id: string;
  worker_id: string;
  dry_run: boolean;
  skipped: boolean;
  reason: string | null;
  scanned_candidates: number;
  eligible_candidates: number;
  enqueued_count: number;
  blocked_count: number;
  not_needed_count: number;
  deduplicated_count: number;
  blocked: Array<{ account_id: string; username: string; reason: string }>;
  enqueued: Array<{ account_id: string; username: string; request_id: string | null }>;
};

export async function runAutoRestartTick(
  supabase: SupabaseLike,
  options: {
    workerId: string;
    requestedByActor?: string;
    callerToken?: string | null;
    env?: Record<string, string | undefined>;
    now?: Date;
    dryRun?: boolean;
    actor?: string;
    manual?: boolean;
    internal?: boolean;
    overview?: { candidates: Array<Record<string, unknown>> };
    evaluateEligibility?: (
      accountId: string,
      runType: "account_session" | "outreach_session",
      phasesToRun?: { welcome: boolean; follow: boolean; unfollow: boolean },
    ) => Promise<{ ok: boolean; reason: string }>;
  },
): Promise<{ status: 200 | 401 | 403 | 503; result: AutoRestartTickSummary }> {
  const manualActorOnly = options.manual === true && !isRunDispatcherWorkerId(options.workerId);
  if (!manualActorOnly) {
    const workerCheck = await assertTrustedDispatcherIdentity(supabase, options.workerId);
    if (!workerCheck.ok) {
      return { status: 403, result: emptySummary(options.workerId, Boolean(options.dryRun), workerCheck.reason) };
    }
  }

  const env = readAutoRestartTickEnv(options.env);
  const callerToken = options.callerToken?.trim() ?? "";
  if (!options.internal) {
    if (!env.configuredToken) {
      return { status: 503, result: emptySummary(options.workerId, true, "cron_token_not_configured") };
    }
    if (!callerToken) {
      return { status: 401, result: emptySummary(options.workerId, Boolean(options.dryRun), "missing_caller_token") };
    }
    if (callerToken !== env.configuredToken) {
      return { status: 403, result: emptySummary(options.workerId, Boolean(options.dryRun), "invalid_caller_token") };
    }
  }

  const now = options.now ?? new Date();
  const settingsRow = await loadSettingsRow(supabase);
  const rules = rulesFromSettingsRow(settingsRow ?? undefined);
  const checkEveryMinutes = Math.max(1, readNumber(settingsRow?.check_every_minutes, rules.checkEveryMinutes || 15));
  const extendedRules = {
    ...rules,
    restartYellowAccounts: readBoolean(settingsRow?.restart_yellow_accounts, false),
    restartRedAccounts: readBoolean(settingsRow?.restart_red_accounts, false),
    maxRestartsPerDay: Math.max(0, readNumber(settingsRow?.max_restarts_per_day_per_account, 3)),
    maxRestartsPerWindow: Math.max(0, readNumber(settingsRow?.max_restarts_per_window_per_account, 2)),
    maxRetriesAfterInitialFailure: Math.max(
      0,
      readNumber(
        settingsRow?.max_retries_after_initial_failure,
        rules.maxRetriesAfterInitialFailure,
      ),
    ),
    restartDelayMinutes: Math.max(1, readNumber(settingsRow?.restart_delay_minutes, rules.restartDelayMinutes || 20)),
  };

  const tickGate = schedulerTickGate({
    enabled: extendedRules.enabled,
    mode: extendedRules.mode,
    dryRun: options.dryRun,
  });
  const forceDryRun = tickGate.forceDryRun;
  const tickBucket = autoRestartTickLockBucketStart(now);
  const tickId = autoRestartTickIdempotencyKey(options.workerId, tickBucket);
  const requestId = `auto-restart-tick-${Date.now().toString(36)}`;
  const lockHeld = !forceDryRun && !options.manual;

  if (!forceDryRun && !options.manual) {
    const lock = await acquireTickLock(supabase, {
      idempotencyKey: tickId,
      workerId: options.workerId,
      metadata: {
        tick_bucket: tickBucket,
        tick_lock_bucket_minutes: 1,
        check_every_minutes: checkEveryMinutes,
      },
    });
    if (!lock.acquired) {
      return {
        status: 200,
        result: {
          ...emptySummary(options.workerId, false, lock.reason),
          tick_id: tickId,
          deduplicated_count: 1,
        },
      };
    }
  }

  if (tickGate.skipReason) {
    const summary = emptySummary(options.workerId, forceDryRun, tickGate.skipReason);
    summary.tick_id = tickId;
    summary.dry_run = forceDryRun;
    summary.skipped = true;
    if (lockHeld) await completeTickLock(supabase, tickId, "completed");
    return { status: 200, result: summary };
  }

  const summary = emptySummary(options.workerId, forceDryRun, null);
  summary.tick_id = tickId;
  summary.dry_run = forceDryRun;

  try {
    const overview = options.overview
      ? { candidates: options.overview.candidates as never[], enabled: true, mode: extendedRules.mode } as unknown as Awaited<ReturnType<typeof getAutoRestartData>>
      : await getAutoRestartData();
    summary.scanned_candidates = overview.candidates.length;

    const follow60ControlResult = await query(supabase, "follow_60s_canary_controls")
      .select("account_id,status,baseline_follow_count,evaluation_increment,target_follow_count,metadata_safe")
      .eq("status", "armed")
      .limit(100);
    if (follow60ControlResult.error) {
      throw new Error(follow60ControlResult.error.message || "follow60_armed_controls_unavailable");
    }
    const follow60ControlRows = readRows(follow60ControlResult.data) as Follow60ControlRow[];
    const follow60ControlByAccount = new Map(
      follow60ControlRows.map((row) => [readString(row.account_id), row]),
    );

    const since = todayStartIso(now);
    const restartCounts = await loadRestartCounts(supabase, since);
    for (const rawCandidate of overview.candidates) {
      const follow60Resolution = resolveArmedFollow60Control({
        row: follow60ControlByAccount.get(rawCandidate.accountId),
        candidate: rawCandidate,
        now,
        globalActiveControlCount: follow60ControlRows.length,
      });
      const candidate = follow60Resolution.ok && follow60Resolution.control
        ? projectArmedFollow60Candidate(rawCandidate, follow60Resolution.control)
        : rawCandidate;
      const follow60Authority = follow60Resolution.ok && follow60Resolution.control !== null;
      if (!candidate.restartEligible) {
        const decision = candidate.decisionOutcome === "not_needed" ? "not_needed" : "blocked";
        if (decision === "not_needed") {
          summary.not_needed_count += 1;
        } else {
          summary.blocked_count += 1;
          summary.blocked.push({
            account_id: candidate.accountId,
            username: candidate.username,
            reason: candidate.blockReason || "blocked",
          });
        }
        if (!forceDryRun) {
          await writeDecision(supabase, {
            requestId,
            idempotencyKey: `${tickId}:${candidate.accountId}:evaluated`,
            actor: options.actor || "system",
            accountId: candidate.accountId,
            deviceId: candidate.deviceId || null,
            action: "auto_restart_candidate_evaluated",
            decision,
            reason: candidate.blockReason || decision,
            mode: extendedRules.mode,
            metadata: candidateDecisionMetadata(candidate, {
              enqueueAllowed: false,
              evaluatedAt: now.toISOString(),
            }),
            priorRunId: candidate.sourceRunId || null,
            businessSessionId: candidate.sourceBusinessSessionId || null,
          });
        }
        continue;
      }

      summary.eligible_candidates += 1;
      const blockReasons: string[] = [];
      if (!follow60Resolution.ok) blockReasons.push(follow60Resolution.reason);
      const riskReason = passesRiskPolicy(candidate, extendedRules);
      if (riskReason) blockReasons.push(riskReason);

      // The validated Follow60 V3 control plus the Worker-side V2 runtime
      // binding replaces the legacy resume plan for this one fresh-boundary
      // Follow-only attempt. All independent safety gates below still apply.
      const resumeSupport = follow60Authority
        ? { ok: true as const, reason: "" }
        : resumePlanRuntimeSupported(candidate);
      if (!resumeSupport.ok) blockReasons.push(resumeSupport.reason);

      const delayReason = restartDelayBlockReason(candidate.reliability.nextRestartAt, now);
      if (delayReason) blockReasons.push(delayReason);

      const attemptsReason = maxRetriesBlockReason(
        candidate.reliability.retryIndex,
        extendedRules.maxRetriesAfterInitialFailure,
      );
      if (
        attemptsReason
        && candidate.operatorStopContinuation !== true
        && !follow60Authority
      ) blockReasons.push(attemptsReason);

      if (
        candidate.reliability.businessDaySast
        && !sameSastBusinessDay(candidate.reliability.businessDaySast, now)
      ) {
        blockReasons.push("business_day_sast_changed");
      }

      const restartsToday = restartCounts.byAccount.get(candidate.accountId) ?? 0;
      const businessSessionId = candidate.sourceBusinessSessionId;
      const restartsInBusinessSession = businessSessionId
        ? restartCounts.byBusinessSession.get(`${candidate.accountId}:${businessSessionId}`) ?? 0
        : 0;
      const progressContinuation = candidate.operatorStopContinuation === true
        ? false
        : candidate.reliability.businessProgressMade === true;
      const phaseKey = resumePhaseKey(candidate.plannedPhasesToRun);
      const reasonKey = resumeReasonKey(candidate);
      const lineageKey = resumeLineageBudgetKey(candidate);
      const restartsForPhase = restartCounts.byPhase.get(`${candidate.accountId}:${phaseKey}`) ?? 0;
      const restartsForReason = restartCounts.byReason.get(`${candidate.accountId}:${reasonKey}`) ?? 0;
      const restartsForLineage = restartCounts.byLineage.get(lineageKey) ?? 0;
      const restartsForSourceRun = candidate.sourceRunId
        ? restartCounts.bySourceRun.get(`${candidate.accountId}:${candidate.sourceRunId}`) ?? 0
        : 0;
      if (!businessSessionId) blockReasons.push("business_session_id_missing");
      // A valid armed Follow60 control is already a globally unique, DB-bound
      // one-shot budget. Legacy retry counters from earlier terminal requests
      // cannot consume that new authorization; the control is terminalized if
      // its single activation fails and therefore cannot create a retry loop.
      if (!follow60Authority && extendedRules.maxRestartsPerDay > 0 && restartsToday >= extendedRules.maxRestartsPerDay) {
        blockReasons.push("max_restarts_day");
      }
      if (!follow60Authority && extendedRules.maxRestartsPerWindow > 0 && restartsInBusinessSession >= extendedRules.maxRestartsPerWindow) {
        blockReasons.push("max_restarts_window");
      }
      if (!follow60Authority && extendedRules.maxRestartsPerDay > 0 && restartsForPhase >= extendedRules.maxRestartsPerDay) {
        blockReasons.push("max_restarts_phase_business_day");
      }
      if (!follow60Authority && extendedRules.maxRestartsPerDay > 0 && restartsForReason >= extendedRules.maxRestartsPerDay) {
        blockReasons.push("max_restarts_reason_business_day");
      }
      if (!follow60Authority && (restartsForLineage > 0 || restartsForSourceRun > 0)) {
        blockReasons.push("resume_lineage_retry_budget_exhausted");
      }

      if (blockReasons.length) {
        summary.blocked_count += 1;
        const reason = blockReasons.join(",");
        summary.blocked.push({ account_id: candidate.accountId, username: candidate.username, reason });
        if (!forceDryRun) {
          await writeBlockedCandidateDecision(supabase, {
            candidate,
            requestId,
            idempotencyKey: `${tickId}:${candidate.accountId}:blocked`,
            actor: options.actor || "system",
            reason,
            mode: extendedRules.mode,
            evaluatedAt: now.toISOString(),
            restartCountDay: restartsToday,
            restartCountWindow: restartsInBusinessSession,
          });
        }
        continue;
      }

      if (forceDryRun) {
        summary.enqueued_count += 1;
        summary.enqueued.push({ account_id: candidate.accountId, username: candidate.username, request_id: null });
        continue;
      }

      // A request may terminalize before creating a new ig_runs row (claim
      // validation, device preflight, etc.). In that case the latest run keeps
      // advertising the previous nextRetryIndex. Advance from the durable
      // enqueue history so a later natural tick cannot reuse the same
      // idempotency key and report a phantom enqueue of the old request.
      const nextRetryIndex = follow60Authority || candidate.operatorStopContinuation === true
        ? 0
        : Math.max(
          candidate.nextRetryIndex,
          progressContinuation ? candidate.nextRetryIndex : restartsInBusinessSession + 1,
        );
      const scheduledCandidate = nextRetryIndex === candidate.nextRetryIndex
        ? candidate
        : {
          ...candidate,
          nextRetryIndex,
          reliability: {
            ...candidate.reliability,
            nextRetryIndex: String(nextRetryIndex),
            nextAttempt: String(nextRetryIndex + 1),
          },
        };
      const baseEnqueueKey = autoRestartEnqueueIdempotencyKey({
        accountId: candidate.accountId,
        businessSessionId,
        retryIndex: nextRetryIndex,
        progressSourceRunId: progressContinuation ? candidate.sourceRunId : undefined,
      });
      const enqueueKey = follow60Resolution.ok && follow60Resolution.control
        ? `${baseEnqueueKey}:follow60:${follow60Resolution.control.controlId}`
        : baseEnqueueKey;

      let deviceId: string | null = null;
      try {
        const runType = candidate.plannedRunType === "outreach_session"
          ? "outreach_session"
          : "account_session";
        const eligibility = options.evaluateEligibility
          ? await options.evaluateEligibility(candidate.accountId, runType, candidate.plannedPhasesToRun)
          : await (async () => {
            const { evaluateRunStartEligibility } = await import("./run-control.ts");
            return evaluateRunStartEligibility(candidate.accountId, runType, {
              trigger: "scheduler",
              phasesToRun: runType === "account_session" ? candidate.plannedPhasesToRun : undefined,
            });
          })();
        if (!eligibility.ok) {
          summary.blocked_count += 1;
          summary.blocked.push({
            account_id: candidate.accountId,
            username: candidate.username,
            reason: eligibility.reason,
          });
          await writeBlockedCandidateDecision(supabase, {
            candidate,
            requestId,
            idempotencyKey: `${enqueueKey}:blocked`,
            actor: options.actor || "system",
            reason: eligibility.reason,
            mode: extendedRules.mode,
            evaluatedAt: now.toISOString(),
            restartCountDay: restartsToday,
            restartCountWindow: restartsInBusinessSession,
          });
          continue;
        }

        deviceId = candidate.deviceId || null;
        let executionWorkerId = options.workerId;
        let trustedDispatcherVerifiedAt: string | null = null;
        if (deviceId) {
          const dispatcherResolution = manualActorOnly
            ? await resolveTrustedDispatcherWorkerForPhoneDevice(supabase, deviceId)
            : {
              ok: true as const,
              workerId: options.workerId,
              verifiedAt: new Date().toISOString(),
              reason: "",
            };
          if (!dispatcherResolution.ok) {
            summary.blocked_count += 1;
            summary.blocked.push({
              account_id: candidate.accountId,
              username: candidate.username,
              reason: dispatcherResolution.reason,
            });
            await writeBlockedCandidateDecision(supabase, {
              candidate,
              requestId,
              idempotencyKey: `${enqueueKey}:dispatcher-blocked`,
              actor: options.actor || "system",
              reason: dispatcherResolution.reason,
              mode: extendedRules.mode,
              evaluatedAt: now.toISOString(),
              deviceId,
              restartCountDay: restartsToday,
              restartCountWindow: restartsInBusinessSession,
            });
            continue;
          }
          executionWorkerId = dispatcherResolution.workerId;
          trustedDispatcherVerifiedAt = dispatcherResolution.verifiedAt;
          if (!manualActorOnly) {
            const deviceTrust = await assertTrustedDispatcherIdentity(supabase, executionWorkerId, {
              deviceIds: [deviceId],
            });
            if (!deviceTrust.ok) {
              summary.blocked_count += 1;
              summary.blocked.push({
                account_id: candidate.accountId,
                username: candidate.username,
                reason: deviceTrust.reason,
              });
              await writeBlockedCandidateDecision(supabase, {
                candidate,
                requestId,
                idempotencyKey: `${enqueueKey}:device-trust-blocked`,
                actor: options.actor || "system",
                reason: deviceTrust.reason,
                mode: extendedRules.mode,
                evaluatedAt: now.toISOString(),
                deviceId,
                restartCountDay: restartsToday,
                restartCountWindow: restartsInBusinessSession,
              });
              continue;
            }
          }
          const deviceLock = await acquireDeviceLock(supabase, {
            deviceId,
            workerId: executionWorkerId,
            accountId: candidate.accountId,
            appInstanceId: candidate.appInstanceId || null,
            leaseSeconds: env.deviceLockLeaseSeconds,
          });
          if (!deviceLock.ok) {
            summary.blocked_count += 1;
            summary.blocked.push({
              account_id: candidate.accountId,
              username: candidate.username,
              reason: deviceLock.reason,
            });
            await writeBlockedCandidateDecision(supabase, {
              candidate,
              requestId,
              idempotencyKey: `${enqueueKey}:device-lock-blocked`,
              actor: options.actor || "system",
              reason: deviceLock.reason,
              mode: extendedRules.mode,
              evaluatedAt: now.toISOString(),
              deviceId,
              restartCountDay: restartsToday,
              restartCountWindow: restartsInBusinessSession,
            });
            continue;
          }
        }

        const baseResumeMetadata = buildAutoRestartResumePlanMetadata(scheduledCandidate, now);
        const resumeMetadata = follow60Resolution.ok && follow60Resolution.control
          ? attachArmedFollow60Contract(
            baseResumeMetadata,
            follow60Resolution.control,
            scheduledCandidate.sourceRunId,
            {
              welcome: rawCandidate.plannedQuotaRemaining.welcome,
              unfollow: rawCandidate.plannedQuotaRemaining.unfollow,
              outreach: rawCandidate.plannedQuotaRemaining.outreach,
            },
          )
          : baseResumeMetadata;
        const requestedByActor = options.requestedByActor
          || (options.manual ? MANUAL_RESTART_AUDIT_ACTOR : options.actor || "system");
        const requestData = await enqueueAutoRestartRequest(supabase, {
          accountId: candidate.accountId,
          workerId: executionWorkerId,
          idempotencyKey: enqueueKey,
          runType: candidate.plannedRunType === "outreach_session" ? "outreach_session" : "account_session",
          metadata: {
            source: AUTO_RESTART_TICK_SOURCE,
            trigger_source: options.manual ? "manual_auto_restart" : "scheduled_auto_restart",
            trigger: options.manual ? "manual_operator" : "scheduler_tick",
            requested_by_actor: requestedByActor,
            execution_worker_id: executionWorkerId,
            trusted_dispatcher_verified_at: trustedDispatcherVerifiedAt,
            worker_id: executionWorkerId,
            auto_restart: true,
            ...resumeMetadata,
          },
        });

        const requestRow = (requestData ?? {}) as Record<string, unknown>;
        const newRequestId = readString(requestRow.id, "") || null;
        const returnedRequestStatus = readString(requestRow.status, "").toLowerCase();
        if (!newRequestId || !ENQUEUE_ACTIVE_REQUEST_STATUSES.has(returnedRequestStatus)) {
          if (deviceId) await releaseDeviceLock(supabase, deviceId, executionWorkerId);
          const reason = !newRequestId
            ? "enqueue_request_id_missing"
            : `enqueue_returned_terminal_request:${returnedRequestStatus || "unknown"}`;
          summary.blocked_count += 1;
          summary.blocked.push({
            account_id: candidate.accountId,
            username: candidate.username,
            reason,
          });
          await writeBlockedCandidateDecision(supabase, {
            candidate: scheduledCandidate,
            requestId,
            idempotencyKey: `${enqueueKey}:terminal-response`,
            actor: options.actor || "system",
            reason,
            mode: extendedRules.mode,
            evaluatedAt: now.toISOString(),
            deviceId,
            restartCountDay: restartsToday,
            restartCountWindow: restartsInBusinessSession,
          });
          continue;
        }
        if (deviceId && newRequestId) {
          const bound = await bindDeviceLockToRequest(supabase, {
            deviceId,
            workerId: executionWorkerId,
            requestId: newRequestId,
            leaseSeconds: env.deviceLockLeaseSeconds,
          });
          if (!bound.ok) {
            await supabase.rpc("cancel_account_run_request", {
              p_request_id: newRequestId,
              p_reason: bound.reason,
            });
            await releaseDeviceLock(supabase, deviceId, executionWorkerId);
            summary.blocked_count += 1;
            summary.blocked.push({
              account_id: candidate.accountId,
              username: candidate.username,
              reason: bound.reason,
            });
            await writeBlockedCandidateDecision(supabase, {
              candidate,
              requestId,
              idempotencyKey: `${enqueueKey}:bind-blocked`,
              actor: options.actor || "system",
              reason: bound.reason,
              mode: extendedRules.mode,
              evaluatedAt: now.toISOString(),
              deviceId,
              restartCountDay: restartsToday,
              restartCountWindow: restartsInBusinessSession,
            });
            continue;
          }
        }
        summary.enqueued_count += 1;
        summary.enqueued.push({
          account_id: candidate.accountId,
          username: candidate.username,
          request_id: newRequestId,
        });
        await writeDecision(supabase, {
          requestId,
          idempotencyKey: enqueueKey,
          actor: options.actor || "system",
          accountId: candidate.accountId,
          deviceId,
          action: "auto_restart_request_enqueued",
          decision: "enqueued",
          reason: "eligible",
          mode: extendedRules.mode,
          priorRunId: candidate.sourceRunId || null,
          newRequestId,
          restartCountDay: restartsToday + 1,
          restartCountWindow: restartsInBusinessSession + 1,
          businessSessionId,
          metadata: {
            ...candidateDecisionMetadata(scheduledCandidate, {
              enqueueAllowed: true,
              evaluatedAt: now.toISOString(),
              reason: "eligible",
            }),
            username: candidate.username,
            attempt_id: nextRetryIndex + 1,
            retry_index: nextRetryIndex,
            previous_run_id: candidate.reliability.lastRunId || null,
            root_failure_code: candidate.reliability.rootFailureCode || null,
            failure_signature: candidate.reliability.failureSignature || null,
            failure_category: candidate.reliability.failureCategory || null,
            quota_remaining: scheduledCandidate.plannedQuotaRemaining,
            phases_to_run: scheduledCandidate.plannedPhasesToRun,
            scheduled_at: now.toISOString(),
            claimed_at: null,
            completed_at: null,
            result: "scheduled",
          },
        });
        if (candidate.reliability.failureCategory === "recoverable_python_runtime_failure") try {
          await query(supabase, "runtime_events").insert({
            event_type: `recoverable_python_failure_restart_${nextRetryIndex}_scheduled`,
            severity: "info",
            visibility: "admin_only",
            account_id: candidate.accountId,
            run_id: candidate.reliability.lastRunId || null,
            job_id: newRequestId,
            source: AUTO_RESTART_TICK_SOURCE,
            reason: "recoverable_python_runtime_failure",
            message: `Recoverable Python failure restart ${nextRetryIndex} scheduled.`,
            metadata: {
              business_session_id: businessSessionId,
              attempt_id: nextRetryIndex + 1,
              retry_index: nextRetryIndex,
              root_failure_code: candidate.reliability.rootFailureCode || null,
              failure_signature: candidate.reliability.failureSignature || null,
            },
          });
        } catch {
          // The request + canonical decision are authoritative; event delivery
          // is an internal best-effort projection only.
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "auto_restart_enqueue_failed";
        summary.blocked_count += 1;
        summary.blocked.push({ account_id: candidate.accountId, username: candidate.username, reason });
        await writeDecision(supabase, {
          requestId,
          idempotencyKey: `${enqueueKey}:error`,
          actor: options.actor || "system",
          accountId: candidate.accountId,
          deviceId,
          action: "auto_restart_runtime_rejected",
          decision: "blocked",
          reason,
          mode: extendedRules.mode,
          priorRunId: candidate.sourceRunId || null,
          restartCountDay: restartsToday,
          restartCountWindow: restartsInBusinessSession,
          businessSessionId,
          metadata: candidateDecisionMetadata(candidate, {
            enqueueAllowed: false,
            evaluatedAt: now.toISOString(),
          }),
        });
        if (deviceId) {
          await releaseDeviceLock(supabase, deviceId, options.workerId);
        }
      }
    }

    // P3: human-confirmed resume authorizations ("Prêt à relancer") are
    // consumed here, on the same canonical tick, never in dry-run/shadow.
    if (!forceDryRun) {
      await processHumanConfirmedResumes(supabase, {
        summary,
        candidates: overview.candidates,
        requestId,
        actor: options.actor || "system",
        mode: extendedRules.mode,
        workerId: options.workerId,
        leaseSeconds: env.deviceLockLeaseSeconds,
        now,
        restartCounts,
        maxRestartsPerDay: extendedRules.maxRestartsPerDay,
        maxRestartsPerWindow: extendedRules.maxRestartsPerWindow,
      });
    }

  } catch (error) {
    // Unexpected engine/backend failure: finalize the held lock as failed
    // with a redacted reason so scheduler-status exposes a real last_error,
    // then surface the original error to the caller. Business outcomes
    // (disabled, no candidates, exclusions, per-candidate errors) never
    // reach this path.
    if (lockHeld) await failTickLock(supabase, tickId, error);
    throw error;
  }

  if (lockHeld) {
    await completeTickLock(supabase, tickId, "completed", undefined, {
      scanned_candidates: summary.scanned_candidates,
      eligible_candidates: summary.eligible_candidates,
      enqueued_count: summary.enqueued_count,
      blocked_count: summary.blocked_count,
      not_needed_count: summary.not_needed_count,
      deduplicated_count: summary.deduplicated_count,
    });
  }

  return { status: 200, result: summary };
}

function emptySummary(workerId: string, dryRun: boolean, reason: string | null): AutoRestartTickSummary {
  return {
    tick_id: "",
    worker_id: workerId,
    dry_run: dryRun,
    skipped: Boolean(reason),
    reason,
    scanned_candidates: 0,
    eligible_candidates: 0,
    enqueued_count: 0,
    blocked_count: 0,
    not_needed_count: 0,
    deduplicated_count: 0,
    blocked: [],
    enqueued: [],
  };
}

/**
 * P3 — consume human-confirmed resume authorizations ("Prêt à relancer").
 *
 * Runs inside the canonical Auto Restart tick (no second scheduler). For
 * each ARMED authorization:
 *   - the active window must still contain now (else the authorization is
 *     expired with the stable reason `resume_authorization_expired`);
 *   - the canonical run-start gates apply (manual_only excluded, no active
 *     run/request, assignment window active);
 *   - the device lock is acquired before the authorization can be consumed;
 *   - authorization consumption + request creation + linkage are one DB
 *     transaction; any failure leaves the authorization armed and retryable;
 *   - a pre-business phase-plan failure restores one generation of retry
 *     credit through the generic reconciliation RPC.
 */
async function processHumanConfirmedResumes(
  supabase: SupabaseLike,
  input: {
    summary: AutoRestartTickSummary;
    candidates: AutoRestartCandidate[];
    requestId: string;
    actor: string;
    mode: AutoRestartMode;
    workerId: string;
    leaseSeconds: number;
    now: Date;
    restartCounts: Awaited<ReturnType<typeof loadRestartCounts>>;
    maxRestartsPerDay: number;
    maxRestartsPerWindow: number;
  },
) {
  const { summary, now } = input;
  const resolvedIncidentReconciliation = await supabase.rpc("reconcile_resolved_incident_resume_windows_v1", {});
  if (resolvedIncidentReconciliation.error) {
    throw new Error(resolvedIncidentReconciliation.error.message || "resolved_incident_resume_reconciliation_failed");
  }
  const restoration = await supabase.rpc("restore_prebusiness_resume_retry_credits_v1", {});
  if (restoration.error) {
    throw new Error(restoration.error.message || "resume_retry_credit_reconciliation_failed");
  }
  const armedResult = await (query(supabase, "incident_resume_authorizations")
    .select("id,incident_id,account_id,run_id,resume_plan_id,resume_window_key,scheduled_window_start,scheduled_window_end,status,retry_generation,frozen_phase_plan,test") as QueryBuilder)
    .eq("status", "armed")
    .order("armed_at", { ascending: true })
    .limit(100) as unknown as QueryResult;
  if (armedResult.error) {
    throw new Error(armedResult.error.message || "resume_authorizations_unavailable");
  }
  const authorizations = readRows(armedResult.data);

  for (const authorization of authorizations) {
    const authorizationId = readString(authorization.id);
    const incidentId = readString(authorization.incident_id);
    const accountId = readString(authorization.account_id);
    const originalRunId = readString(authorization.run_id);
    const resumePlanId = readString(authorization.resume_plan_id);
    const resumeWindowKey = readString(authorization.resume_window_key);
    if (!authorizationId || !accountId || !incidentId) continue;
    let notificationCandidate: AutoRestartCandidate | undefined;

    const blockResume = async (reason: string) => {
      summary.blocked_count += 1;
      summary.blocked.push({ account_id: accountId, username: "", reason });
      await writeDecision(supabase, {
        requestId: input.requestId,
        idempotencyKey: `resume-auth:${authorizationId}:${reason}`,
        actor: input.actor,
        accountId,
        deviceId: null,
        action: "human_confirmed_resume_evaluated",
        decision: "blocked",
        reason,
        mode: input.mode,
        metadata: {
          incident_id: incidentId,
          authorization_id: authorizationId,
          authorization_source: "incident_resume_authorizations",
          ...(notificationCandidate
            ? candidateDecisionMetadata(notificationCandidate, {
              enqueueAllowed: false,
              evaluatedAt: now.toISOString(),
              reason,
              authorizationSource: "incident_resume_authorizations",
            })
            : {}),
        },
        priorRunId: originalRunId || null,
      });
    };

    try {
      // Internal test authorizations are visible but never enqueue anything.
      if (authorization.test === true) {
        await blockResume("test_authorization_excluded");
        continue;
      }

      const windowStart = readString(authorization.scheduled_window_start) || null;
      const windowEnd = readString(authorization.scheduled_window_end) || null;
      if (!windowContainsNow(windowStart, windowEnd, now)) {
        await markAuthorizationExpired(supabase, authorizationId, now);
        await updateIncidentRecoveryState(supabase, incidentId, "resume_authorization_expired");
        await blockResume("resume_authorization_expired");
        continue;
      }

      const incidentResult = await query(supabase, "account_incidents")
        .select("id,account_id,run_id,incident_type,status")
        .eq("id", incidentId)
        .eq("account_id", accountId)
        .maybeSingle();
      const incident = incidentResult.data as SupabaseRecord | null | undefined;
      if (incidentResult.error || !incident || readString(incident.status) !== "resolved") {
        await blockResume("resume_incident_not_resolved");
        continue;
      }
      const restrictionPreflight = readString(incident.incident_type) === "instagram_account_restriction";
      const candidate = input.candidates.find((row) => row.accountId === accountId);
      notificationCandidate = candidate;
      const storedPlan = originalRunId ? await loadResumePlanForRun(supabase, originalRunId) : null;
      if (!storedPlan || readString(storedPlan.resume_state) !== "awaiting_human_resume_authorization") {
        await blockResume("resume_plan_not_recoverable");
        continue;
      }

      const lineageVerdict = validateResumeAuthorizationLineage({
        authorizationRunId: originalRunId,
        incidentRunId: readString(incident.run_id),
        storedPlanRunId: readString(storedPlan.run_id),
        latestCanonicalRunId: candidate?.sourceRunId || "",
        latestTerminationClass: candidate?.reliability.sessionTerminationClass || "",
        resolvedIncidentAuthorized: true,
      });
      if (!restrictionPreflight && !lineageVerdict.ok) {
        await markAuthorizationExpired(supabase, authorizationId, now);
        await updateIncidentRecoveryState(supabase, incidentId, lineageVerdict.reason, {
          authorization_run_id: originalRunId || null,
          latest_canonical_run_id: candidate?.sourceRunId || null,
        });
        await blockResume(lineageVerdict.reason);
        continue;
      }

      const rebuiltCandidate = !restrictionPreflight && candidate
        ? rebuildResolvedIncidentResumeCandidate(candidate)
        : null;
      const follow60sOneShot = rebuiltCandidate
        ? applyFollow60sOneShotFrozenPlan({
          baseMetadata: buildAutoRestartResumePlanMetadata(rebuiltCandidate, now),
          frozenPlan: authorization.frozen_phase_plan,
          authorizationAccountId: accountId,
          originalRunId,
          liveFollowRemaining: rebuiltCandidate.plannedQuotaRemaining.follow,
        })
        : null;
      if (follow60sOneShot?.matched && !follow60sOneShot.ok) {
        await blockResume(follow60sOneShot.reason);
        continue;
      }

      if (!restrictionPreflight && candidate && follow60sOneShot?.matched !== true) {
        // A resolved incident is the operator's explicit one-shot authorization
        // for evaluation on the next natural tick.  The generic retry delay is
        // not applied a second time; every live cap, warmup, phase, assignment,
        // run/request, lock and restart-budget gate below remains authoritative.
        const phaseKey = resumePhaseKey(candidate.plannedPhasesToRun);
        const reasonKey = resumeReasonKey(candidate);
        const lineageKey = resumeLineageBudgetKey(candidate);
        const accountRestarts = input.restartCounts.byAccount.get(accountId) ?? 0;
        const sessionRestarts = candidate.sourceBusinessSessionId
          ? input.restartCounts.byBusinessSession.get(`${accountId}:${candidate.sourceBusinessSessionId}`) ?? 0
          : 0;
        const phaseRestarts = input.restartCounts.byPhase.get(`${accountId}:${phaseKey}`) ?? 0;
        const reasonRestarts = input.restartCounts.byReason.get(`${accountId}:${reasonKey}`) ?? 0;
        const lineageRestarts = input.restartCounts.byLineage.get(lineageKey) ?? 0;
        const sourceRunRestarts = candidate.sourceRunId
          ? input.restartCounts.bySourceRun.get(`${accountId}:${candidate.sourceRunId}`) ?? 0
          : 0;
        const budgetReason = input.maxRestartsPerDay > 0 && accountRestarts >= input.maxRestartsPerDay
          ? "max_restarts_day"
          : input.maxRestartsPerWindow > 0 && sessionRestarts >= input.maxRestartsPerWindow
            ? "max_restarts_window"
            : input.maxRestartsPerDay > 0 && phaseRestarts >= input.maxRestartsPerDay
              ? "max_restarts_phase_business_day"
              : input.maxRestartsPerDay > 0 && reasonRestarts >= input.maxRestartsPerDay
                ? "max_restarts_reason_business_day"
                : lineageRestarts > 0 || sourceRunRestarts > 0
                  ? "resume_lineage_retry_budget_exhausted"
                  : "";
        if (budgetReason) {
          await blockResume(budgetReason);
          continue;
        }
      }

      const deviceId = readString(storedPlan.device_id) || candidate?.deviceId || null;
      let resumeMetadata: ReturnType<typeof buildAutoRestartResumePlanMetadata>
        | ReturnType<typeof buildInstagramRestrictionPreflightMetadata>;
      if (restrictionPreflight) {
        const holdResult = await query(supabase, "instagram_account_restriction_holds")
          .select("id,status,incident_id")
          .eq("account_id", accountId)
          .eq("incident_id", incidentId)
          .eq("status", "verification_required")
          .maybeSingle();
        if (holdResult.error || !holdResult.data) {
          await blockResume("restriction_preflight_not_authorized");
          continue;
        }
        resumeMetadata = buildInstagramRestrictionPreflightMetadata({
          accountId,
          assignmentId: readString(storedPlan.assignment_id) || null,
          deviceId,
          appInstanceId: readString(storedPlan.app_instance_id) || null,
          incidentId,
          authorizationId,
          resumePlanId,
          originalRunId,
          retryGeneration: readNumber(authorization.retry_generation, 0),
          now,
        });
      } else {
        // Normal recovery remains candidate-backed: a resolved incident never
        // invents business phases or quota.
        if (!candidate) {
          await blockResume("resume_candidate_unavailable");
          continue;
        }
        resumeMetadata = follow60sOneShot?.matched
          ? follow60sOneShot.metadata
          : buildAutoRestartResumePlanMetadata(
            rebuiltCandidate ?? rebuildResolvedIncidentResumeCandidate(candidate),
            now,
          );
        Object.assign(resumeMetadata.resume_plan, {
          business_date: sastBusinessDay(now),
          resume_reason: "resolved_incident_human_authorized",
          resume_strategy: candidate.safeRestartStrategy,
          source_incident_id: incidentId,
          source_request_id: input.requestId,
          authorization_id: authorizationId,
          retry_generation: readNumber(authorization.retry_generation, 0),
          last_checkpoint: {
            prior_run_id: originalRunId || null,
            prior_target_id: candidate.priorTargetId,
            next_target_id: candidate.nextTargetId,
            exact_viewport_resume_available: candidate.exactViewportResumeAvailable,
            safe_restart_reason: candidate.safeRestartReason,
          },
          last_safe_checkpoint: {
            prior_run_id: originalRunId || null,
            prior_target_id: candidate.priorTargetId,
            next_target_id: candidate.nextTargetId,
            strategy: candidate.safeRestartStrategy,
          },
        });
      }
      const planReason = validateCanonicalResumePlan(resumeMetadata.resume_plan as Record<string, unknown>);
      if (planReason) {
        await blockResume(planReason);
        continue;
      }
      const actionablePhases = Object.values(resumeMetadata.resume_plan.phases_to_run)
        .some((enabled) => enabled === true);
      if (!restrictionPreflight && !actionablePhases) {
        await blockResume("resume_phase_plan_not_actionable");
        continue;
      }

      // Canonical run-start gates: manual_only excluded, no active run or
      // request, assignment window still active for a scheduler trigger.
      const { evaluateRunStartEligibility } = await import("./run-control.ts");
      const eligibility = await evaluateRunStartEligibility(accountId, "account_session", {
        trigger: "scheduler",
        phasesToRun: resumeMetadata.resume_plan.phases_to_run,
        restrictionPreflight: restrictionPreflight
          ? { incidentId, authorizationId }
          : undefined,
      });
      if (!eligibility.ok) {
        // The authorization stays armed: a later tick in the same window may
        // still consume it once the transient gate clears.
        await blockResume(eligibility.reason);
        continue;
      }

      if (deviceId) {
        const deviceLock = await acquireDeviceLock(supabase, {
          deviceId,
          workerId: input.workerId,
          accountId,
          appInstanceId: null,
          leaseSeconds: input.leaseSeconds,
        });
        if (!deviceLock.ok) {
          // The authorization has not been consumed yet; the natural next
          // tick may retry after this transient lock clears.
          await blockResume(deviceLock.reason);
          continue;
        }
      }

      try {
        const metadata = {
          source: AUTO_RESTART_TICK_SOURCE,
          trigger: "scheduler_tick",
          trigger_source: "scheduled_auto_restart",
          requested_by_actor: input.actor,
          execution_worker_id: input.workerId,
          worker_id: input.workerId,
          auto_restart: true,
          ...resumeMetadata,
          recovery_mode: "human_confirmed_resume",
          restriction_preflight_only: restrictionPreflight,
          incident_id: incidentId,
          authorization_id: authorizationId,
          original_run_id: originalRunId || null,
          prior_run_id: originalRunId || null,
          resume_plan_id: resumePlanId || null,
          resume_window_key: resumeWindowKey || null,
        };
        const atomicResult = await consumeAuthorizationAndCreateRequest(supabase, {
          authorizationId,
          workerId: input.workerId,
          deviceId,
          metadata,
        });
        const newRequestId = readString(atomicResult?.request_id, "") || null;
        summary.enqueued_count += 1;
        summary.enqueued.push({ account_id: accountId, username: "", request_id: newRequestId });
        await writeDecision(supabase, {
          requestId: input.requestId,
          idempotencyKey: `resume-auth:${authorizationId}`,
          actor: input.actor,
          accountId,
          deviceId,
          action: "human_confirmed_resume_enqueued",
          decision: "enqueued",
          reason: restrictionPreflight ? "instagram_restriction_preflight" : "human_confirmed_resume",
          mode: input.mode,
          metadata: {
            incident_id: incidentId,
            authorization_id: authorizationId,
            resume_window_key: resumeWindowKey || null,
            authorization_source: "incident_resume_authorizations",
            ...(candidate
              ? candidateDecisionMetadata(candidate, {
                enqueueAllowed: true,
                evaluatedAt: now.toISOString(),
                reason: restrictionPreflight ? "instagram_restriction_preflight" : "human_confirmed_resume",
                authorizationSource: "incident_resume_authorizations",
              })
              : {}),
          },
          priorRunId: originalRunId || null,
          newRequestId,
          businessSessionId: candidate?.sourceBusinessSessionId || null,
        });
      } catch (error) {
        // The database transaction rolls back authorization consumption and
        // every linked write. Release the pre-acquired device lease only.
        if (deviceId) {
          await releaseDeviceLock(supabase, deviceId, input.workerId);
        }
        await blockResume(sanitizeTickFailureReason(error));
      }
    } catch (error) {
      // Per-authorization isolation: one broken row never stops the tick.
      await blockResume(sanitizeTickFailureReason(error));
    }
  }
}
