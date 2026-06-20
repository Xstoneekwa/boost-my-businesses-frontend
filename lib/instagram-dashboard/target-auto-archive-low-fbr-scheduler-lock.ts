export const TARGET_AUTO_ARCHIVE_LOW_FBR_CLAIM_LOCK_RPC = "claim_target_auto_archive_low_fbr_scheduler_lock";
export const TARGET_AUTO_ARCHIVE_LOW_FBR_RELEASE_LOCK_RPC = "release_target_auto_archive_low_fbr_scheduler_lock";

export type TargetAutoArchiveLowFbrLockClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

function readBooleanRpcData(data: unknown) {
  if (data === true || data === false) return data;
  if (data === "true" || data === "t" || data === 1) return true;
  if (data === "false" || data === "f" || data === 0) return false;
  return false;
}

export async function claimTargetAutoArchiveLowFbrSchedulerLock(
  supabase: TargetAutoArchiveLowFbrLockClient,
  workerId: string,
  ttlSeconds: number,
) {
  const { data, error } = await supabase.rpc(TARGET_AUTO_ARCHIVE_LOW_FBR_CLAIM_LOCK_RPC, {
    worker_id: workerId,
    ttl_seconds: ttlSeconds,
  });
  if (error) throw new Error(error.message || "scheduler_lock_claim_failed");
  return readBooleanRpcData(data);
}

export async function releaseTargetAutoArchiveLowFbrSchedulerLock(
  supabase: TargetAutoArchiveLowFbrLockClient,
  workerId: string,
) {
  try {
    await supabase.rpc(TARGET_AUTO_ARCHIVE_LOW_FBR_RELEASE_LOCK_RPC, {
      worker_id: workerId,
    });
  } catch {
    // Best-effort release; TTL expires stale locks.
  }
}

export async function withTargetAutoArchiveLowFbrSchedulerLock<T>(
  supabase: TargetAutoArchiveLowFbrLockClient,
  input: { workerId: string; ttlSeconds: number; run: () => Promise<T> },
): Promise<{ ok: true; result: T } | { ok: false; reason: "already_running" }> {
  const lockAcquired = await claimTargetAutoArchiveLowFbrSchedulerLock(
    supabase,
    input.workerId,
    input.ttlSeconds,
  );
  if (!lockAcquired) {
    return { ok: false, reason: "already_running" };
  }

  try {
    return { ok: true, result: await input.run() };
  } finally {
    await releaseTargetAutoArchiveLowFbrSchedulerLock(supabase, input.workerId);
  }
}
