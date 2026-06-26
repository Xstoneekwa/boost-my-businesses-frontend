import { timingSafeEqual } from "node:crypto";
import {
  boundedTargetVerificationLimit,
  boundedTargetVerificationMaxDurationMs,
  emptyTargetVerificationBatchSummary,
  processTargetVerificationBatch,
  safeTargetVerificationWorkerId,
  type TargetVerificationBatchSummary,
  type TargetVerificationProcessorResult,
  type TargetVerificationSupabaseClient,
} from "./instagram-target-verification-processor.ts";
import {
  emptyPeriodicRevalidationSchedulerSummary,
} from "./target-periodic-revalidation.ts";
import {
  runPeriodicTargetRevalidationScheduler,
  type PeriodicRevalidationSchedulerSummary,
  type PeriodicRevalidationSchedulerSupabase,
} from "./target-periodic-revalidation-scheduler.ts";

export type TargetVerificationCronSkipReason =
  | "cron_disabled"
  | "cron_token_not_configured"
  | "scheduler_lock_busy"
  | "no_jobs"
  | "method_not_allowed_use_post";

export type TargetVerificationCronAuthReason =
  | "missing_caller_token"
  | "invalid_caller_token";

export type TargetVerificationCronResult = {
  enabled: boolean;
  dry_run: boolean;
  limit: number;
  worker_id: string;
  max_duration_ms: number;
  lock_acquired: boolean;
  skipped: boolean;
  reason: TargetVerificationCronSkipReason | TargetVerificationCronAuthReason | null;
  stopped_early_reason: string | null;
  summary: TargetVerificationBatchSummary;
  periodic_revalidation: PeriodicRevalidationSchedulerSummary;
};

export type TargetVerificationCronEnv = {
  enabled: boolean;
  dryRun: boolean;
  limit: number;
  maxDurationMs: number;
  lockTtlSeconds: number;
  configuredToken: string | null;
  workerId: string;
};

export type TargetVerificationCronOptions = {
  callerToken?: string | null;
  env?: NodeJS.ProcessEnv;
  processBatch?: (
    supabase: TargetVerificationSupabaseClient,
    options: Parameters<typeof processTargetVerificationBatch>[1],
  ) => Promise<TargetVerificationProcessorResult>;
  enqueuePeriodicRevalidation?: (
    supabase: TargetVerificationSupabaseClient,
    options: { env?: NodeJS.ProcessEnv; dryRun?: boolean; enqueueLimit?: number },
  ) => Promise<PeriodicRevalidationSchedulerSummary>;
};

export type TargetVerificationCronRun =
  | { status: 401 | 403 | 405 | 503; result: TargetVerificationCronResult }
  | { status: 200; result: TargetVerificationCronResult };

const CRON_TOKEN_HEADER = "x-ct-target-verification-cron-token";
const DEFAULT_WORKER_ID = "ct_verify_cron";

function readEnvBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function readEnvInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function readTargetVerificationCronEnv(
  env: NodeJS.ProcessEnv = process.env,
): TargetVerificationCronEnv {
  const configuredToken = env.CT_TARGET_VERIFICATION_CRON_TOKEN?.trim() || null;
  const maxDurationMs = boundedTargetVerificationMaxDurationMs(env.CT_TARGET_VERIFICATION_CRON_MAX_DURATION_MS);

  return {
    enabled: readEnvBoolean(env.CT_TARGET_VERIFICATION_CRON_ENABLED, false),
    dryRun: readEnvBoolean(env.CT_TARGET_VERIFICATION_CRON_DRY_RUN, true),
    limit: boundedTargetVerificationLimit(env.CT_TARGET_VERIFICATION_CRON_LIMIT),
    maxDurationMs,
    lockTtlSeconds: readEnvInteger(env.CT_TARGET_VERIFICATION_CRON_LOCK_TTL_SECONDS, 120, 30, 600),
    configuredToken,
    workerId: safeTargetVerificationWorkerId(env.CT_TARGET_VERIFICATION_CRON_WORKER_ID || DEFAULT_WORKER_ID),
  };
}

export function extractTargetVerificationCronToken(request: Request) {
  const headerToken = request.headers.get(CRON_TOKEN_HEADER)?.trim();
  if (headerToken) return headerToken;

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() ?? "";
}

export function tokensMatchConstantTime(expected: string, provided: string) {
  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function evaluateTargetVerificationCronAuth(
  cronEnv: TargetVerificationCronEnv,
  callerToken: string | null | undefined,
): { ok: true } | { ok: false; status: 401 | 403 | 503; reason: TargetVerificationCronAuthReason | "cron_token_not_configured" } {
  if (!cronEnv.configuredToken) {
    return { ok: false, status: 503, reason: "cron_token_not_configured" };
  }

  const normalizedCallerToken = callerToken?.trim() ?? "";
  if (!normalizedCallerToken) {
    return { ok: false, status: 401, reason: "missing_caller_token" };
  }

  if (!tokensMatchConstantTime(cronEnv.configuredToken, normalizedCallerToken)) {
    return { ok: false, status: 403, reason: "invalid_caller_token" };
  }

  return { ok: true };
}

function buildSkippedCronResult(
  cronEnv: TargetVerificationCronEnv,
  input: {
    reason: TargetVerificationCronSkipReason | TargetVerificationCronAuthReason;
    lockAcquired?: boolean;
  },
): TargetVerificationCronResult {
  return {
    enabled: cronEnv.enabled,
    dry_run: cronEnv.dryRun,
    limit: cronEnv.limit,
    worker_id: cronEnv.workerId,
    max_duration_ms: cronEnv.maxDurationMs,
    lock_acquired: input.lockAcquired ?? false,
    skipped: true,
    reason: input.reason,
    stopped_early_reason: null,
    summary: emptyTargetVerificationBatchSummary(),
    periodic_revalidation: emptyPeriodicRevalidationSchedulerSummary(),
  };
}

function readBooleanRpcData(data: unknown) {
  if (data === true || data === false) return data;
  if (data === "true" || data === "t" || data === 1) return true;
  if (data === "false" || data === "f" || data === 0) return false;
  return false;
}

async function claimSchedulerLock(
  supabase: TargetVerificationSupabaseClient,
  workerId: string,
  ttlSeconds: number,
) {
  const { data, error } = await supabase.rpc("claim_ct_target_verification_scheduler_lock", {
    worker_id: workerId,
    ttl_seconds: ttlSeconds,
  });

  if (error) throw new Error(error.message || "scheduler_lock_claim_failed");
  return readBooleanRpcData(data);
}

async function releaseSchedulerLock(
  supabase: TargetVerificationSupabaseClient,
  workerId: string,
) {
  try {
    await supabase.rpc("release_ct_target_verification_scheduler_lock", {
      worker_id: workerId,
    });
  } catch {
    // Lock TTL expires stale locks; release is best-effort.
  }
}

export function evaluateTargetVerificationCronHttpMethod(method: string) {
  const normalized = method.trim().toUpperCase();
  if (normalized === "POST") return { ok: true as const };
  return {
    ok: false as const,
    status: 405 as const,
    reason: "method_not_allowed_use_post" as const,
  };
}

export async function handleTargetVerificationCronRequest(
  request: Request,
  supabase: TargetVerificationSupabaseClient,
  options: Omit<TargetVerificationCronOptions, "callerToken"> = {},
) {
  const methodCheck = evaluateTargetVerificationCronHttpMethod(request.method);
  if (methodCheck.ok) {
    return runTargetVerificationCron(supabase, {
      ...options,
      callerToken: extractTargetVerificationCronToken(request),
    });
  }

  return {
    status: 405,
    result: buildSkippedCronResult(readTargetVerificationCronEnv(options.env), {
      reason: "method_not_allowed_use_post",
    }),
  } satisfies TargetVerificationCronRun;
}

export async function runTargetVerificationCron(
  supabase: TargetVerificationSupabaseClient,
  options: TargetVerificationCronOptions = {},
): Promise<TargetVerificationCronRun> {
  const cronEnv = readTargetVerificationCronEnv(options.env);
  const auth = evaluateTargetVerificationCronAuth(cronEnv, options.callerToken);

  if (!auth.ok) {
    return {
      status: auth.status,
      result: buildSkippedCronResult(cronEnv, { reason: auth.reason }),
    };
  }

  if (!cronEnv.enabled) {
    return {
      status: 200,
      result: buildSkippedCronResult(cronEnv, { reason: "cron_disabled" }),
    };
  }

  const processBatch = options.processBatch ?? processTargetVerificationBatch;
  const enqueuePeriodic = options.enqueuePeriodicRevalidation ?? ((
    supabaseClient: TargetVerificationSupabaseClient,
    schedulerOptions: { env?: NodeJS.ProcessEnv; dryRun?: boolean; enqueueLimit?: number },
  ) => runPeriodicTargetRevalidationScheduler(
    supabaseClient as unknown as PeriodicRevalidationSchedulerSupabase,
    schedulerOptions,
  ));
  let lockAcquired = false;

  try {
    lockAcquired = await claimSchedulerLock(supabase, cronEnv.workerId, cronEnv.lockTtlSeconds);
    if (!lockAcquired) {
      return {
        status: 200,
        result: buildSkippedCronResult(cronEnv, {
          reason: "scheduler_lock_busy",
          lockAcquired: false,
        }),
      };
    }

    const periodicRevalidation = await enqueuePeriodic(supabase, {
      env: options.env,
      dryRun: cronEnv.dryRun,
      enqueueLimit: cronEnv.limit * 5,
    });

    const batchResult = await processBatch(supabase, {
      limit: cronEnv.limit,
      dryRun: cronEnv.dryRun,
      workerId: cronEnv.workerId,
      maxDurationMs: cronEnv.maxDurationMs,
    });

    if (batchResult.summary.claimed_count === 0) {
      return {
        status: 200,
        result: {
          enabled: true,
          dry_run: batchResult.dry_run,
          limit: batchResult.limit,
          worker_id: batchResult.worker_id,
          max_duration_ms: batchResult.max_duration_ms,
          lock_acquired: true,
          skipped: true,
          reason: "no_jobs",
          stopped_early_reason: batchResult.stopped_early_reason,
          summary: batchResult.summary,
          periodic_revalidation: periodicRevalidation,
        },
      };
    }

    return {
      status: 200,
      result: {
        enabled: true,
        dry_run: batchResult.dry_run,
        limit: batchResult.limit,
        worker_id: batchResult.worker_id,
        max_duration_ms: batchResult.max_duration_ms,
        lock_acquired: true,
        skipped: false,
        reason: null,
        stopped_early_reason: batchResult.stopped_early_reason,
        summary: batchResult.summary,
        periodic_revalidation: periodicRevalidation,
      },
    };
  } finally {
    if (lockAcquired) {
      await releaseSchedulerLock(supabase, cronEnv.workerId);
    }
  }
}
