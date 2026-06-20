import assert from "node:assert/strict";
import test from "node:test";
import {
  TARGET_AUTO_ARCHIVE_LOW_FBR_CLAIM_LOCK_RPC,
  withTargetAutoArchiveLowFbrSchedulerLock,
} from "./target-auto-archive-low-fbr-scheduler-lock.ts";

function makeSupabase(lockState = { held: false, workerId: null }) {
  return {
    async rpc(name, args) {
      if (name === TARGET_AUTO_ARCHIVE_LOW_FBR_CLAIM_LOCK_RPC) {
        if (lockState.held) {
          return { data: false, error: null };
        }
        lockState.held = true;
        lockState.workerId = args.worker_id;
        return { data: true, error: null };
      }
      if (name === "release_target_auto_archive_low_fbr_scheduler_lock") {
        if (lockState.workerId === args.worker_id) {
          lockState.held = false;
          lockState.workerId = null;
        }
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  };
}

test("strict scheduler lock skips concurrent invocation with already_running", async () => {
  const lockState = { held: false, workerId: null };
  const supabase = makeSupabase(lockState);
  let runCalls = 0;

  const first = withTargetAutoArchiveLowFbrSchedulerLock(supabase, {
    workerId: "target_auto_archive_low_fbr_cron",
    ttlSeconds: 900,
    run: async () => {
      runCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return "first";
    },
  });

  const second = withTargetAutoArchiveLowFbrSchedulerLock(supabase, {
    workerId: "target_auto_archive_low_fbr_cron",
    ttlSeconds: 900,
    run: async () => {
      runCalls += 1;
      return "second";
    },
  });

  const [firstRun, secondRun] = await Promise.all([first, second]);

  assert.deepEqual(firstRun, { ok: true, result: "first" });
  assert.deepEqual(secondRun, { ok: false, reason: "already_running" });
  assert.equal(runCalls, 1);
});

test("strict scheduler lock allows a new run after release", async () => {
  const lockState = { held: false, workerId: null };
  const supabase = makeSupabase(lockState);
  let runCalls = 0;

  const first = await withTargetAutoArchiveLowFbrSchedulerLock(supabase, {
    workerId: "target_auto_archive_low_fbr_cron",
    ttlSeconds: 900,
    run: async () => {
      runCalls += 1;
      return "first";
    },
  });

  const second = await withTargetAutoArchiveLowFbrSchedulerLock(supabase, {
    workerId: "target_auto_archive_low_fbr_cron",
    ttlSeconds: 900,
    run: async () => {
      runCalls += 1;
      return "second";
    },
  });

  assert.deepEqual(first, { ok: true, result: "first" });
  assert.deepEqual(second, { ok: true, result: "second" });
  assert.equal(runCalls, 2);
});
