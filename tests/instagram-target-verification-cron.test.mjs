import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTargetVerificationCronAuth,
  extractTargetVerificationCronToken,
  readTargetVerificationCronEnv,
  runTargetVerificationCron,
  tokensMatchConstantTime,
} from "../lib/instagram-target-verification-cron.ts";

const baseEnv = {
  CT_TARGET_VERIFICATION_CRON_TOKEN: "cron-secret-token",
  CT_TARGET_VERIFICATION_CRON_ENABLED: "true",
  CT_TARGET_VERIFICATION_CRON_DRY_RUN: "true",
  CT_TARGET_VERIFICATION_CRON_LIMIT: "5",
};

function makeRequest(headers = {}) {
  return new Request("https://example.test/api/instagram-dashboard/targets/verify-cron", {
    headers,
  });
}

function makeSupabase(lockAcquired = true) {
  return {
    rpc(name, args) {
      if (name === "claim_ct_target_verification_scheduler_lock") {
        return Promise.resolve({ data: lockAcquired, error: null });
      }
      if (name === "release_ct_target_verification_scheduler_lock") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    },
    from() {
      throw new Error("from() should not be called in cron auth-only tests");
    },
  };
}

const emptyBatchResult = {
  limit: 5,
  dry_run: true,
  worker_id: "ct_verify_cron",
  max_duration_ms: 10_000,
  stopped_early_reason: null,
  summary: {
    claimed_count: 0,
    processed_count: 0,
    succeeded_count: 0,
    rejected_count: 0,
    review_count: 0,
    retry_scheduled_count: 0,
    skipped_count: 0,
    rate_limited_count: 0,
    provider_error_count: 0,
    duration_ms: 0,
  },
};

test("readTargetVerificationCronEnv defaults to disabled safe mode", () => {
  const env = readTargetVerificationCronEnv({});
  assert.equal(env.enabled, false);
  assert.equal(env.dryRun, true);
  assert.equal(env.limit, 5);
  assert.equal(env.maxDurationMs, 10_000);
  assert.equal(env.lockTtlSeconds, 120);
  assert.equal(env.configuredToken, null);
  assert.equal(env.workerId, "ct_verify_cron");
});

test("readTargetVerificationCronEnv clamps limit to 10", () => {
  const env = readTargetVerificationCronEnv({
    ...baseEnv,
    CT_TARGET_VERIFICATION_CRON_LIMIT: "99",
  });
  assert.equal(env.limit, 10);
});

test("extractTargetVerificationCronToken reads bearer and custom header", () => {
  const bearerRequest = makeRequest({ Authorization: "Bearer cron-secret-token" });
  assert.equal(extractTargetVerificationCronToken(bearerRequest), "cron-secret-token");

  const headerRequest = makeRequest({
    "x-ct-target-verification-cron-token": "header-token",
  });
  assert.equal(extractTargetVerificationCronToken(headerRequest), "header-token");
});

test("tokensMatchConstantTime rejects mismatched lengths and values", () => {
  assert.equal(tokensMatchConstantTime("abc", "abc"), true);
  assert.equal(tokensMatchConstantTime("abc", "abd"), false);
  assert.equal(tokensMatchConstantTime("abc", "abcd"), false);
  assert.equal(tokensMatchConstantTime("", "abc"), false);
});

test("evaluateTargetVerificationCronAuth blocks missing configured token", () => {
  const cronEnv = readTargetVerificationCronEnv({});
  const auth = evaluateTargetVerificationCronAuth(cronEnv, "anything");
  assert.equal(auth.ok, false);
  if (!auth.ok) {
    assert.equal(auth.status, 503);
    assert.equal(auth.reason, "cron_token_not_configured");
  }
});

test("evaluateTargetVerificationCronAuth blocks missing caller token", () => {
  const cronEnv = readTargetVerificationCronEnv(baseEnv);
  const auth = evaluateTargetVerificationCronAuth(cronEnv, "");
  assert.equal(auth.ok, false);
  if (!auth.ok) {
    assert.equal(auth.status, 401);
    assert.equal(auth.reason, "missing_caller_token");
  }
});

test("evaluateTargetVerificationCronAuth blocks invalid caller token", () => {
  const cronEnv = readTargetVerificationCronEnv(baseEnv);
  const auth = evaluateTargetVerificationCronAuth(cronEnv, "wrong-token");
  assert.equal(auth.ok, false);
  if (!auth.ok) {
    assert.equal(auth.status, 403);
    assert.equal(auth.reason, "invalid_caller_token");
  }
});

test("runTargetVerificationCron skips safely when disabled with valid token", async () => {
  const run = await runTargetVerificationCron(makeSupabase(), {
    env: {
      ...baseEnv,
      CT_TARGET_VERIFICATION_CRON_ENABLED: "false",
    },
    callerToken: "cron-secret-token",
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.skipped, true);
  assert.equal(run.result.reason, "cron_disabled");
  assert.equal(run.result.enabled, false);
  assert.equal(run.result.dry_run, true);
});

test("runTargetVerificationCron skips on busy scheduler lock without processor call", async () => {
  let processorCalled = false;
  const run = await runTargetVerificationCron(makeSupabase(false), {
    env: baseEnv,
    callerToken: "cron-secret-token",
    processBatch: async () => {
      processorCalled = true;
      return emptyBatchResult;
    },
  });

  assert.equal(processorCalled, false);
  assert.equal(run.status, 200);
  assert.equal(run.result.skipped, true);
  assert.equal(run.result.reason, "scheduler_lock_busy");
  assert.equal(run.result.lock_acquired, false);
});

test("runTargetVerificationCron calls processor with dry_run when enabled", async () => {
  let capturedOptions = null;
  const run = await runTargetVerificationCron(makeSupabase(true), {
    env: baseEnv,
    callerToken: "cron-secret-token",
    processBatch: async (_supabase, options) => {
      capturedOptions = options;
      return {
        ...emptyBatchResult,
        dry_run: options.dryRun === true,
        worker_id: options.workerId ?? "ct_verify_cron",
        summary: {
          ...emptyBatchResult.summary,
          claimed_count: 2,
        },
      };
    },
  });

  assert.equal(run.status, 200);
  assert.equal(run.result.skipped, false);
  assert.equal(run.result.dry_run, true);
  assert.equal(run.result.summary.claimed_count, 2);
  assert.equal(capturedOptions?.dryRun, true);
  assert.equal(capturedOptions?.workerId, "ct_verify_cron");
  assert.equal(capturedOptions?.limit, 5);
});

test("runTargetVerificationCron serialized response excludes forbidden strings", async () => {
  const run = await runTargetVerificationCron(makeSupabase(true), {
    env: {
      ...baseEnv,
      CT_TARGET_VERIFICATION_CRON_TOKEN: "super-secret-cron-token-value",
    },
    callerToken: "super-secret-cron-token-value",
    processBatch: async () => ({
      ...emptyBatchResult,
      stopped_early_reason: "rate_limited",
      summary: {
        ...emptyBatchResult.summary,
        rate_limited_count: 1,
      },
    }),
  });

  const serialized = JSON.stringify(run.result).toLowerCase();
  for (const forbidden of ["super-secret", "authorization", "service_role", "vault", "password"]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden leak: ${forbidden}`);
  }
  assert.equal(run.result.stopped_early_reason, "rate_limited");
  assert.equal(run.result.summary.rate_limited_count, 1);
});
