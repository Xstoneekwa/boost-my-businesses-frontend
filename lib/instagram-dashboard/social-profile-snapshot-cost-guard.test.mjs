import assert from "node:assert/strict";
import test from "node:test";

import { classifySocialProfileSnapshotCostGuard } from "./social-profile-snapshot-cost-guard.ts";

const now = new Date("2026-07-25T12:00:00.000Z");
const job = (overrides = {}) => ({
  id: "job-1",
  username_normalized: "example",
  status: "failed",
  attempts: 1,
  available_at: "2026-07-25T11:00:00.000Z",
  last_error_code: "not_found",
  created_at: "2026-07-25T10:00:00.000Z",
  updated_at: "2026-07-25T11:00:00.000Z",
  ...overrides,
});
test("fresh canonical snapshot costs zero provider calls", () => {
  const result = classifySocialProfileSnapshotCostGuard({
    username: "example",
    now,
    latestSuccessfulSnapshotAt: "2026-07-25T10:00:00.000Z",
  });
  assert.equal(result.classification, "skipped_fresh");
  assert.equal(result.providerCallsNewJobMax, 0);
});

test("terminal not_found is suppressed while a rename may collect", () => {
  assert.equal(classifySocialProfileSnapshotCostGuard({ username: "example", now, jobs: [job()] }).classification, "terminal_suppressed");
  assert.equal(classifySocialProfileSnapshotCostGuard({ username: "renamed", now, jobs: [job()] }).classification, "enqueue_allowed");
});

test("retry backoff and due retries never create a duplicate job", () => {
  const backoff = classifySocialProfileSnapshotCostGuard({
    username: "example",
    now,
    jobs: [job({ status: "queued", available_at: "2026-07-25T13:00:00.000Z", last_error_code: "provider_error" })],
  });
  assert.equal(backoff.classification, "retryable_backoff");
  assert.equal(backoff.providerCallsNewJobMax, 0);
  const due = classifySocialProfileSnapshotCostGuard({
    username: "example",
    now,
    jobs: [job({ status: "queued", last_error_code: "provider_error" })],
  });
  assert.equal(due.classification, "existing_job_pending");
  assert.equal(due.existingRetryProviderCallsMax, 1);
});

test("future accounts need no hard-coded allowlist", () => {
  assert.equal(classifySocialProfileSnapshotCostGuard({ username: "future.account", now }).classification, "enqueue_allowed");
});
