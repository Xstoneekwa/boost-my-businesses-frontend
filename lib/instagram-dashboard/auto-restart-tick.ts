import { getAutoRestartData, rulesFromSettingsRow, type AutoRestartMode, type AutoRestartRulePreview } from "@/app/instagram-dashboard/auto-restart-data";
import type { SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import {
  AUTO_RESTART_TICK_SOURCE,
  AUTO_RESTART_TICK_TOKEN_HEADER,
  autoRestartEnqueueIdempotencyKey,
  autoRestartTickIdempotencyKey,
  passesRiskPolicy,
  resumePlanRuntimeSupported,
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
import { buildAutoRestartResumePlanMetadata } from "./auto-restart-resume-metadata";
import {
  maxAttemptsBlockReason,
  restartDelayBlockReason,
} from "./auto-restart-operational";

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

function tickBucketStart(now: Date, checkEveryMinutes: number) {
  const ms = checkEveryMinutes * 60_000;
  const bucket = Math.floor(now.getTime() / ms) * ms;
  return new Date(bucket).toISOString();
}

function todayStartIso(now = new Date()) {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function loadSettingsRow(supabase: SupabaseLike) {
  const result = await query(supabase, "auto_restart_settings")
    .select("*")
    .eq("id", "global")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "auto_restart_settings_unavailable");
  return (result.data ?? null) as SupabaseRecord | null;
}

async function countRestartsToday(supabase: SupabaseLike, accountId: string, sinceIso: string) {
  const result = await query(supabase, "auto_restart_decisions")
    .select("id")
    .eq("account_id", accountId)
    .eq("decision", "enqueued")
    .gte("created_at", sinceIso)
    .limit(100);
  if (result.error) throw new Error(result.error.message || "auto_restart_decisions_unavailable");
  return readRows(result.data).length;
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

async function completeTickLock(supabase: SupabaseLike, idempotencyKey: string, status: "completed" | "failed") {
  await query(supabase, "auto_restart_tick_locks")
    .update({
      status,
      tick_completed_at: new Date().toISOString(),
    })
    .eq("idempotency_key", idempotencyKey);
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
    new_request_id: input.newRequestId ?? null,
    restart_count_day: input.restartCountDay ?? 0,
    metadata_safe: input.metadata ?? {},
  });
  if (insert.error && !insert.error.message?.toLowerCase().includes("duplicate")) {
    throw new Error(insert.error.message || "auto_restart_decision_write_failed");
  }
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
    maxAttemptsPerSession: Math.max(0, readNumber(settingsRow?.max_attempts_per_session, rules.maxAttemptsPerSession || 2)),
    restartDelayMinutes: Math.max(1, readNumber(settingsRow?.restart_delay_minutes, rules.restartDelayMinutes || 20)),
  };

  const tickGate = schedulerTickGate({
    enabled: extendedRules.enabled,
    mode: extendedRules.mode,
    dryRun: options.dryRun,
  });
  const forceDryRun = tickGate.forceDryRun;
  const tickBucket = tickBucketStart(now, checkEveryMinutes);
  const tickId = autoRestartTickIdempotencyKey(options.workerId, tickBucket);
  const requestId = `auto-restart-tick-${Date.now().toString(36)}`;

  if (!forceDryRun && !options.manual) {
    const lock = await acquireTickLock(supabase, {
      idempotencyKey: tickId,
      workerId: options.workerId,
      metadata: { tick_bucket: tickBucket, check_every_minutes: checkEveryMinutes },
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
    if (!forceDryRun && !options.manual) await completeTickLock(supabase, tickId, "completed");
    return { status: 200, result: summary };
  }

  const overview = options.overview
    ? { candidates: options.overview.candidates as never[], enabled: true, mode: extendedRules.mode } as unknown as Awaited<ReturnType<typeof getAutoRestartData>>
    : await getAutoRestartData();
  const summary = emptySummary(options.workerId, forceDryRun, null);
  summary.tick_id = tickId;
  summary.dry_run = forceDryRun;
  summary.scanned_candidates = overview.candidates.length;

  const since = todayStartIso(now);
  for (const candidate of overview.candidates) {
    if (!candidate.restartEligible) {
      summary.blocked_count += 1;
      summary.blocked.push({
        account_id: candidate.accountId,
        username: candidate.username,
        reason: candidate.blockReason || "blocked",
      });
      continue;
    }

    summary.eligible_candidates += 1;
    const blockReasons: string[] = [];
    const riskReason = passesRiskPolicy(candidate, extendedRules);
    if (riskReason) blockReasons.push(riskReason);

    const resumeSupport = resumePlanRuntimeSupported(candidate);
    if (!resumeSupport.ok) blockReasons.push(resumeSupport.reason);

    const delayReason = restartDelayBlockReason(candidate.reliability.nextRestartAt, now);
    if (delayReason) blockReasons.push(delayReason);

    const attemptsReason = maxAttemptsBlockReason(
      candidate.reliability.currentAttempt,
      extendedRules.maxAttemptsPerSession,
    );
    if (attemptsReason) blockReasons.push(attemptsReason);

    const restartsToday = await countRestartsToday(supabase, candidate.accountId, since);
    if (extendedRules.maxRestartsPerDay > 0 && restartsToday >= extendedRules.maxRestartsPerDay) {
      blockReasons.push("max_restarts_day");
    }
    if (extendedRules.maxRestartsPerWindow > 0 && restartsToday >= extendedRules.maxRestartsPerWindow) {
      blockReasons.push("max_restarts_window");
    }

    if (blockReasons.length) {
      summary.blocked_count += 1;
      const reason = blockReasons.join(",");
      summary.blocked.push({ account_id: candidate.accountId, username: candidate.username, reason });
      await writeDecision(supabase, {
        requestId,
        idempotencyKey: `${tickId}:${candidate.accountId}:blocked`,
        actor: options.actor || "system",
        accountId: candidate.accountId,
        deviceId: null,
        action: "auto_restart_candidate_evaluated",
        decision: "blocked",
        reason,
        mode: extendedRules.mode,
        metadata: { username: candidate.username },
        priorRunId: candidate.reliability.lastRunId || null,
        restartCountDay: restartsToday,
      });
      continue;
    }

    if (forceDryRun) {
      summary.enqueued_count += 1;
      summary.enqueued.push({ account_id: candidate.accountId, username: candidate.username, request_id: null });
      continue;
    }

    const businessSessionId = candidate.reliability.lastRunId || candidate.accountId;
    const enqueueKey = autoRestartEnqueueIdempotencyKey({
      accountId: candidate.accountId,
      businessSessionId,
      tickBucketIso: tickBucket,
    });

    let deviceId: string | null = null;
    try {
      const { evaluateRunStartEligibility } = await import("./run-control.ts");
      const eligibility = await evaluateRunStartEligibility(
        candidate.accountId,
        candidate.plannedRunType === "outreach_session" ? "outreach_session" : "account_session",
        { trigger: "scheduler" },
      );
      if (!eligibility.ok) {
        summary.blocked_count += 1;
        summary.blocked.push({
          account_id: candidate.accountId,
          username: candidate.username,
          reason: eligibility.reason,
        });
        await writeDecision(supabase, {
          requestId,
          idempotencyKey: `${enqueueKey}:blocked`,
          actor: options.actor || "system",
          accountId: candidate.accountId,
          deviceId: null,
          action: "auto_restart_candidate_blocked",
          decision: "blocked",
          reason: eligibility.reason,
          mode: extendedRules.mode,
          priorRunId: candidate.reliability.lastRunId || null,
          restartCountDay: restartsToday,
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
          continue;
        }
      }

      const resumeMetadata = buildAutoRestartResumePlanMetadata(candidate);
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

      const newRequestId = readString((requestData as Record<string, unknown>)?.id, "") || null;
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
        priorRunId: candidate.reliability.lastRunId || null,
        newRequestId,
        restartCountDay: restartsToday + 1,
      });
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
        priorRunId: candidate.reliability.lastRunId || null,
        restartCountDay: restartsToday,
      });
      if (deviceId) {
        await releaseDeviceLock(supabase, deviceId, options.workerId);
      }
    }
  }

  if (!forceDryRun && !options.manual) {
    await completeTickLock(supabase, tickId, "completed");
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
    deduplicated_count: 0,
    blocked: [],
    enqueued: [],
  };
}
