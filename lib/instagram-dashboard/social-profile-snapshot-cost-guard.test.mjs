import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifySocialProfileSnapshotCostGuard,
  isSuppressibleSocialProfileTerminalError,
  socialProfileSnapshotGuardResultFromRpc,
} from "./social-profile-snapshot-cost-guard.ts";

const NOW = new Date("2026-07-22T13:00:00.000Z");

function job(overrides = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    username_normalized: "future_account",
    status: "failed",
    attempts: 1,
    available_at: "2026-07-22T12:00:00.000Z",
    last_error_code: "not_found",
    created_at: "2026-07-22T11:00:00.000Z",
    updated_at: "2026-07-22T12:00:00.000Z",
    ...overrides,
  };
}

function classify(overrides = {}) {
  return classifySocialProfileSnapshotCostGuard({
    username: "future_account",
    now: NOW,
    jobs: [],
    ...overrides,
  });
}

test("fresh successful snapshot skips a new job", () => {
  const result = classify({ latestSuccessfulSnapshotAt: "2026-07-22T12:30:00.000Z" });
  assert.equal(result.classification, "skipped_fresh");
  assert.equal(result.providerCallsNewJobMax, 0);
});

test("terminal not_found for the current username is suppressed", () => {
  const result = classify({ jobs: [job()] });
  assert.equal(result.classification, "terminal_suppressed");
  assert.equal(result.reason, "latest_terminal_failure_for_current_username");
});

test("a terminal job for an old username does not suppress a new username", () => {
  const result = classify({ username: "renamed_account", jobs: [job()] });
  assert.equal(result.classification, "enqueue_allowed");
});

test("a successful snapshot newer than the terminal lifts suppression", () => {
  const result = classify({
    latestSuccessfulSnapshotAt: "2026-07-20T12:00:00.000Z",
    jobs: [job({ updated_at: "2026-07-19T12:00:00.000Z" })],
  });
  assert.equal(result.classification, "enqueue_allowed");
});

test("explicit admin refresh bypasses terminal suppression", () => {
  const result = classify({ jobs: [job()], explicitAdminRefresh: true });
  assert.equal(result.classification, "enqueue_allowed");
  assert.equal(result.reason, "explicit_admin_refresh");
});

test("explicit admin refresh still refuses an active duplicate", () => {
  const result = classify({ jobs: [job({ status: "queued", last_error_code: null })], explicitAdminRefresh: true });
  assert.equal(result.classification, "existing_job_pending");
});

test("queued job prevents a new job", () => {
  const result = classify({ jobs: [job({ status: "queued", attempts: 0, last_error_code: null })] });
  assert.equal(result.classification, "existing_job_pending");
  assert.equal(result.providerCallsNewJobMax, 0);
});

test("processing job prevents a new job", () => {
  const result = classify({ jobs: [job({ status: "processing", last_error_code: null })] });
  assert.equal(result.classification, "existing_job_pending");
  assert.equal(result.reason, "existing_job_processing");
});

test("retryable job inside backoff prevents a new job and has no due cost", () => {
  const result = classify({ jobs: [job({ status: "queued", attempts: 1, available_at: "2026-07-22T14:00:00.000Z", last_error_code: "provider_invalid_response" })] });
  assert.equal(result.classification, "retryable_backoff");
  assert.equal(result.existingRetryProviderCallsMax, 0);
});

test("due retry is reported separately from new-job cost", () => {
  const result = classify({ jobs: [job({ status: "queued", attempts: 1, last_error_code: "provider_invalid_response" })] });
  assert.equal(result.classification, "existing_job_pending");
  assert.equal(result.providerCallsNewJobMax, 0);
  assert.equal(result.existingRetryProviderCallsMax, 1);
  assert.equal(result.retryDue, true);
});

test("retry exhaustion suppresses automatic recollection", () => {
  const result = classify({ jobs: [job({ status: "failed", attempts: 3, last_error_code: "retry_exhausted:timeout" })] });
  assert.equal(result.classification, "terminal_suppressed");
});

test("queued row at the attempt ceiling is treated as exhausted", () => {
  const result = classify({ jobs: [job({ status: "queued", attempts: 3, last_error_code: "provider_invalid_response" })] });
  assert.equal(result.classification, "terminal_suppressed");
  assert.equal(result.reason, "retry_exhausted_existing_job");
});

test("transient terminal-looking text is not suppressible unless explicitly classified", () => {
  for (const code of ["provider_invalid_response", "timeout", "rate_limit", "provider_unavailable", "network_error"]) {
    assert.equal(isSuppressibleSocialProfileTerminalError(code), false, code);
  }
});

test("only the bounded terminal contract is suppressible", () => {
  for (const code of ["not_found", "invalid_username", "profile_unavailable", "retry_exhausted:provider_error"]) {
    assert.equal(isSuppressibleSocialProfileTerminalError(code), true, code);
  }
});

test("future accounts are covered without an allowlist", () => {
  const result = classify({ username: "created_in_future" });
  assert.equal(result.classification, "enqueue_allowed");
});

test("username comparison normalizes at-sign and case", () => {
  const result = classify({ username: "@Future_Account", jobs: [job()] });
  assert.equal(result.classification, "terminal_suppressed");
});

test("invalid current username is refused without provider cost", () => {
  const result = classify({ username: "not valid!" });
  assert.equal(result.classification, "terminal_suppressed");
  assert.equal(result.reason, "invalid_username");
  assert.equal(result.providerCallsNewJobMax, 0);
});

test("distinct idempotency keys do not change active identity classification", () => {
  const active = job({ status: "queued", attempts: 0, idempotency_key: "old-key", last_error_code: null });
  assert.equal(classify({ jobs: [active] }).classification, "existing_job_pending");
});

test("historical terminal jobs are never mutated by classification", () => {
  const terminal = job();
  const before = structuredClone(terminal);
  classify({ jobs: [terminal] });
  assert.deepEqual(terminal, before);
});

test("RPC projection keeps new-job and existing-retry budgets separate", () => {
  const result = socialProfileSnapshotGuardResultFromRpc({
    classification: "existing_job_pending",
    reason: "existing_job_due",
    job_id: "job-id",
    job_status: "queued",
    created: false,
    provider_calls_new_job_max: 0,
    existing_retry_provider_calls_max: 1,
    retry_due: true,
  });
  assert.deepEqual(result, {
    classification: "existing_job_pending",
    reason: "existing_job_due",
    jobId: "job-id",
    jobStatus: "queued",
    created: false,
    providerCallsNewJobMax: 0,
    existingRetryProviderCallsMax: 1,
    retryDue: true,
  });
});

test("cost guard sources contain no account-specific identifiers or provider call", () => {
  const source = readFileSync(new URL("./social-profile-snapshot-cost-guard.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../supabase/migrations/20260722134621_social_profile_snapshot_enqueue_cost_guard_v1.sql", import.meta.url), "utf8");
  assert.doesNotMatch(`${source}\n${migration}`, /lookupInstagramPublicProfile|followers_count\s*=|following_count\s*=/);
  assert.doesNotMatch(`${source}\n${migration}`, /recovery_test|tracker|fitness/i);
});

test("normal client cannot call the admin refresh route without the shared admin guard", () => {
  const route = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/[accountId]/social-profile-refresh/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireInstagramAdmin\(\)/);
  assert.ok(route.indexOf("requireInstagramAdmin()") < route.indexOf("await guardSocialProfileSnapshotJob"));
});

test("dashboard read routes do not import the enqueue guard", () => {
  const statsRoute = readFileSync(new URL("../../app/api/instagram-dashboard/profiles/[accountId]/stats-history/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(statsRoute, /guardSocialProfileSnapshotJob|enqueueDailySocialProfileSnapshotJobs/);
});
