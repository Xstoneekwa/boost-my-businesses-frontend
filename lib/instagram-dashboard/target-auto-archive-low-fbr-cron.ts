import { timingSafeEqual } from "node:crypto";
import { createSupabaseClient } from "@/lib/supabase";
import {
  runTargetAutoArchiveLowFbrPolicyGlobal,
  type TargetAutoArchiveGlobalResult,
} from "./target-auto-archive-low-fbr-executor";
import { targetAutoArchiveLowFbrFlags } from "./target-auto-archive-low-fbr-policy";

export type TargetAutoArchiveCronSkipReason =
  | "cron_disabled"
  | "cron_token_not_configured"
  | "scheduler_lock_busy";

export type TargetAutoArchiveCronAuthReason =
  | "missing_caller_token"
  | "invalid_caller_token";

export type TargetAutoArchiveCronResult = {
  enabled: boolean;
  dry_run: boolean;
  worker_id: string;
  lock_acquired: boolean;
  skipped: boolean;
  reason: TargetAutoArchiveCronSkipReason | TargetAutoArchiveCronAuthReason | null;
  summary: TargetAutoArchiveGlobalResult;
};

export type TargetAutoArchiveCronEnv = {
  enabled: boolean;
  lockTtlSeconds: number;
  configuredToken: string | null;
  workerId: string;
};

export type TargetAutoArchiveCronRun =
  | { status: 401 | 403 | 503; result: TargetAutoArchiveCronResult }
  | { status: 200; result: TargetAutoArchiveCronResult };

const CRON_TOKEN_HEADER = "x-target-auto-archive-low-fbr-cron-token";
const DEFAULT_WORKER_ID = "target_auto_archive_low_fbr_cron";

function readEnvBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function readEnvInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function readTargetAutoArchiveLowFbrCronEnv(
  env: NodeJS.ProcessEnv = process.env,
): TargetAutoArchiveCronEnv {
  return {
    enabled: readEnvBoolean(env.TARGET_AUTO_ARCHIVE_LOW_FBR_CRON_ENABLED, false),
    lockTtlSeconds: readEnvInteger(env.TARGET_AUTO_ARCHIVE_LOW_FBR_CRON_LOCK_TTL_SECONDS, 900, 60, 3600),
    configuredToken: env.TARGET_AUTO_ARCHIVE_LOW_FBR_CRON_TOKEN?.trim() || null,
    workerId: env.TARGET_AUTO_ARCHIVE_LOW_FBR_CRON_WORKER_ID?.trim() || DEFAULT_WORKER_ID,
  };
}

export function extractTargetAutoArchiveLowFbrCronToken(request: Request) {
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

export function evaluateTargetAutoArchiveLowFbrCronAuth(
  cronEnv: TargetAutoArchiveCronEnv,
  callerToken: string | null | undefined,
): { ok: true } | { ok: false; status: 401 | 403 | 503; reason: TargetAutoArchiveCronAuthReason | "cron_token_not_configured" } {
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

function readBooleanRpcData(data: unknown) {
  if (data === true || data === false) return data;
  if (data === "true" || data === "t" || data === 1) return true;
  if (data === "false" || data === "f" || data === 0) return false;
  return false;
}

async function claimSchedulerLock(
  supabase: ReturnType<typeof createSupabaseClient>,
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
  supabase: ReturnType<typeof createSupabaseClient>,
  workerId: string,
) {
  try {
    await supabase.rpc("release_ct_target_verification_scheduler_lock", {
      worker_id: workerId,
    });
  } catch {
    // Best-effort release.
  }
}

function emptySummary(): TargetAutoArchiveGlobalResult {
  const flags = targetAutoArchiveLowFbrFlags();
  return {
    scanned: 0,
    targets_skipped_unreliable: 0,
    targets_skipped_under_minimum: 0,
    targets_qualified: 0,
    targets_archived: 0,
    targets_readd_blocked: 0,
    errors: 0,
    dryRun: flags.dryRun,
    enabled: flags.enabled,
    items: [],
  };
}

export async function runTargetAutoArchiveLowFbrCron(input: {
  callerToken?: string | null;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<TargetAutoArchiveCronRun> {
  const cronEnv = readTargetAutoArchiveLowFbrCronEnv(input.env);
  const policyFlags = targetAutoArchiveLowFbrFlags(input.env);
  const auth = evaluateTargetAutoArchiveLowFbrCronAuth(cronEnv, input.callerToken);

  if (!auth.ok) {
    return {
      status: auth.status,
      result: {
        enabled: cronEnv.enabled,
        dry_run: policyFlags.dryRun,
        worker_id: cronEnv.workerId,
        lock_acquired: false,
        skipped: true,
        reason: auth.reason,
        summary: emptySummary(),
      },
    };
  }

  if (!cronEnv.enabled) {
    return {
      status: 200,
      result: {
        enabled: false,
        dry_run: policyFlags.dryRun,
        worker_id: cronEnv.workerId,
        lock_acquired: false,
        skipped: true,
        reason: "cron_disabled",
        summary: emptySummary(),
      },
    };
  }

  const supabase = createSupabaseClient();
  let lockAcquired = false;

  try {
    lockAcquired = await claimSchedulerLock(supabase, cronEnv.workerId, cronEnv.lockTtlSeconds);
    if (!lockAcquired) {
      return {
        status: 200,
        result: {
          enabled: cronEnv.enabled,
          dry_run: policyFlags.dryRun,
          worker_id: cronEnv.workerId,
          lock_acquired: false,
          skipped: true,
          reason: "scheduler_lock_busy",
          summary: emptySummary(),
        },
      };
    }

    const summary = await runTargetAutoArchiveLowFbrPolicyGlobal();
    return {
      status: 200,
      result: {
        enabled: cronEnv.enabled,
        dry_run: policyFlags.dryRun,
        worker_id: cronEnv.workerId,
        lock_acquired: true,
        skipped: false,
        reason: null,
        summary,
      },
    };
  } finally {
    if (lockAcquired) {
      await releaseSchedulerLock(supabase, cronEnv.workerId);
    }
  }
}
