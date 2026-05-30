import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedTargetVerificationLimit,
  processTargetVerificationBatch,
} from "../lib/instagram-target-verification-processor.ts";
import { targetDecisionFromLookup } from "../lib/instagram-targets.ts";

const fixedNow = new Date("2026-05-30T02:00:00.000Z");

const baseLookup = {
  ok: true,
  status: "found",
  input_username: "target_user",
  canonical_username: "target_user",
  instagram_user_id: "123",
  external_profile_id: "profile_123",
  avatar_url: "https://cdn.example.test/avatar.jpg",
  is_private: false,
  is_verified: false,
  followers_count: 1200,
  reason: "found",
  checked_at: fixedNow.toISOString(),
  metadata: {
    cache_hit: false,
    throttle_hit: false,
    rate_limited: false,
    latency_ms: 12,
  },
};

function decisionFromLookup(patch) {
  return targetDecisionFromLookup({ ...baseLookup, ...patch });
}

function pendingJob(id, username, patch = {}) {
  return {
    id,
    target_id: `target-${id}`,
    account_id: "account-1",
    batch_id: "batch-1",
    normalized_username: username,
    status: "pending",
    attempt_count: 0,
    max_attempts: 3,
    next_attempt_at: null,
    locked_at: null,
    locked_by: null,
    created_at: fixedNow.toISOString(),
    ...patch,
  };
}

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.inFilters = [];
    this.updateValues = null;
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  in(column, values) {
    this.inFilters.push([column, values]);
    return this;
  }

  or() {
    return this;
  }

  order() {
    return this;
  }

  update(values) {
    this.updateValues = values;
    return this;
  }

  async insert(values) {
    this.db.audit.push(values);
    return { data: [values], error: null };
  }

  async maybeSingle() {
    const rows = this.rows().filter((row) => this.matches(row));
    return { data: rows[0] ?? null, error: null };
  }

  async limit(count) {
    return { data: this.rows().filter((row) => this.matches(row)).slice(0, count), error: null };
  }

  then(resolve, reject) {
    return this.executeUpdate().then(resolve, reject);
  }

  rows() {
    if (this.table === "ig_targets") return this.db.targets;
    if (this.table === "ct_target_verification_jobs") return this.db.jobs;
    return [];
  }

  matches(row) {
    return (
      this.filters.every(([column, value]) => row[column] === value) &&
      this.inFilters.every(([column, values]) => values.includes(row[column]))
    );
  }

  async executeUpdate() {
    const rows = this.rows().filter((row) => this.matches(row));
    for (const row of rows) Object.assign(row, this.updateValues);
    return { data: rows, error: null };
  }
}

class FakeSupabase {
  constructor(jobs, targets) {
    this.jobs = jobs;
    this.targets = targets;
    this.audit = [];
  }

  from(table) {
    return new FakeQuery(this, table);
  }

  async rpc(name, args) {
    assert.equal(name, "claim_ct_target_verification_jobs");
    const limit = Math.min(Math.max(Number(args.batch_limit) || 5, 1), 10);
    const workerId = String(args.worker_id || "dashboard_verify_batch");
    const ready = this.jobs.filter((job) => {
      const target = this.targets.find((row) => row.id === job.target_id && row.account_id === job.account_id);
      const expiredProcessing = job.status === "processing" && new Date(job.locked_at) < new Date(fixedNow.getTime() - 15 * 60_000);
      return (
        (["pending", "retry_scheduled"].includes(job.status) || expiredProcessing) &&
        (!job.next_attempt_at || new Date(job.next_attempt_at) <= fixedNow) &&
        (!job.locked_at || new Date(job.locked_at) < new Date(fixedNow.getTime() - 15 * 60_000)) &&
        target &&
        !["archived", "deleted"].includes(target.status) &&
        !target.archived_at &&
        !target.deleted_at
      );
    }).slice(0, limit);

    for (const job of ready) {
      job.status = "processing";
      job.attempt_count += 1;
      job.locked_at = fixedNow.toISOString();
      job.locked_by = workerId;
    }

    return { data: ready.map((job) => ({ ...job })), error: null };
  }
}

function fakeDb(jobs) {
  const targets = jobs.map((job) => ({
    id: job.target_id,
    account_id: job.account_id,
    status: "pending_verification",
    archived_at: null,
    deleted_at: null,
  }));
  return new FakeSupabase(jobs, targets);
}

test("bounds claim limit to the processor maximum", () => {
  assert.equal(boundedTargetVerificationLimit(25), 10);
  assert.equal(boundedTargetVerificationLimit(0), 1);
});

test("dry_run previews claimable jobs without mutation or provider calls", async () => {
  const db = fakeDb([pendingJob("1", "eligible_one"), pendingJob("2", "eligible_two")]);
  let providerCalls = 0;

  const result = await processTargetVerificationBatch(db, {
    limit: 2,
    dryRun: true,
    now: () => fixedNow,
    verifyUsername: async () => {
      providerCalls += 1;
      return decisionFromLookup({});
    },
  });

  assert.equal(result.dry_run, true);
  assert.equal(result.summary.claimed_count, 2);
  assert.equal(result.summary.processed_count, 0);
  assert.equal(providerCalls, 0);
  assert.equal(db.jobs.every((job) => job.status === "pending"), true);
});

test("processor maps found eligible target to succeeded summary", async () => {
  const db = fakeDb([pendingJob("1", "eligible_one")]);
  const result = await processTargetVerificationBatch(db, {
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({}),
  });

  assert.equal(result.summary.claimed_count, 1);
  assert.equal(result.summary.processed_count, 1);
  assert.equal(result.summary.succeeded_count, 1);
  assert.equal(db.jobs[0].status, "succeeded");
  assert.equal(db.targets[0].status, "valid");
});

test("processor maps low followers, verified, private and not_found safely", async () => {
  const db = fakeDb([
    pendingJob("1", "low_followers"),
    pendingJob("2", "verified_user"),
    pendingJob("3", "private_user"),
    pendingJob("4", "missing_user"),
  ]);
  const decisions = {
    low_followers: decisionFromLookup({ followers_count: 499 }),
    verified_user: decisionFromLookup({ is_verified: true }),
    private_user: decisionFromLookup({ is_private: true }),
    missing_user: decisionFromLookup({ ok: false, status: "not_found", reason: "not_found", followers_count: null }),
  };

  const result = await processTargetVerificationBatch(db, {
    limit: 4,
    now: () => fixedNow,
    verifyUsername: async (username) => decisions[username],
  });

  assert.equal(result.summary.rejected_count, 4);
  assert.deepEqual(db.targets.map((target) => target.quality_status), [
    "rejected_low_followers",
    "rejected_verified",
    "rejected_private",
    "rejected_not_found",
  ]);
  assert.equal(db.jobs.every((job) => job.status === "succeeded"), true);
});

test("rate_limited schedules retry and stops remaining claimed jobs safely", async () => {
  const db = fakeDb([
    pendingJob("1", "rate_one"),
    pendingJob("2", "not_called"),
    pendingJob("3", "also_not_called"),
  ]);
  const providerCalls = [];

  const result = await processTargetVerificationBatch(db, {
    limit: 3,
    now: () => fixedNow,
    verifyUsername: async (username) => {
      providerCalls.push(username);
      return decisionFromLookup({
        ok: false,
        status: "rate_limited",
        reason: "rate_limited",
        metadata: { rate_limited: true },
      });
    },
  });

  assert.deepEqual(providerCalls, ["rate_one"]);
  assert.equal(result.stopped_early_reason, "rate_limited");
  assert.equal(result.summary.rate_limited_count, 1);
  assert.equal(result.summary.retry_scheduled_count, 3);
  assert.equal(db.jobs.every((job) => job.status === "retry_scheduled"), true);
  assert.equal(db.jobs[1].last_error_code, "batch_stopped_after_rate_limit");
});

test("provider_error retries and max attempts moves to review", async () => {
  const db = fakeDb([
    pendingJob("1", "retry_error"),
    pendingJob("2", "maxed_error", { attempt_count: 2, max_attempts: 3 }),
  ]);

  const result = await processTargetVerificationBatch(db, {
    limit: 2,
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({
      ok: false,
      status: "provider_error",
      reason: "provider_http_error",
    }),
  });

  assert.equal(result.summary.provider_error_count, 2);
  assert.equal(result.summary.retry_scheduled_count, 1);
  assert.equal(result.summary.review_count, 1);
  assert.equal(db.jobs[0].status, "retry_scheduled");
  assert.equal(db.jobs[1].status, "succeeded");
  assert.equal(db.targets[1].quality_status, "review_provider_unavailable");
});

test("claim skips future retry jobs and recovers expired processing locks", async () => {
  const expiredLock = new Date(fixedNow.getTime() - 20 * 60_000).toISOString();
  const futureRetry = new Date(fixedNow.getTime() + 10 * 60_000).toISOString();
  const db = fakeDb([
    pendingJob("1", "future_retry", { status: "retry_scheduled", next_attempt_at: futureRetry }),
    pendingJob("2", "expired_processing", { status: "processing", locked_at: expiredLock }),
    pendingJob("3", "ready_pending"),
  ]);

  const result = await processTargetVerificationBatch(db, {
    limit: 3,
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({}),
  });

  assert.equal(result.summary.claimed_count, 2);
  assert.equal(db.jobs[0].status, "retry_scheduled");
  assert.equal(db.jobs[1].status, "succeeded");
  assert.equal(db.jobs[2].status, "succeeded");
});

test("summary stays safe and excludes raw provider payloads", async () => {
  const db = fakeDb([pendingJob("1", "eligible_one")]);
  const result = await processTargetVerificationBatch(db, {
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({}),
  });

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("raw"), false);
  assert.equal(serialized.includes("authorization"), false);
  assert.equal(serialized.includes("token"), false);
  assert.equal(typeof result.summary.duration_ms, "number");
});
