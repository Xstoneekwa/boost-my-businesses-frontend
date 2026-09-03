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
    if (this.table === "ct_target_availability_current") return this.db.availabilityCurrent;
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
    this.availabilityCurrent = [];
    this.audit = [];
  }

  from(table) {
    return new FakeQuery(this, table);
  }

  async rpc(name, args) {
    if (name === "persist_ct_target_evidence_refresh_v1") {
      const target = this.targets.find((row) => row.id === args.p_target_id && row.account_id === args.p_account_id);
      if (!target || target.normalized_username !== args.p_expected_normalized_username) {
        return { data: "identity_mismatch", error: null };
      }
      if (args.p_outcome === "found") {
        if (target.provider_checked_at && target.provider_checked_at >= args.p_provider_checked_at) {
          return { data: "already_fresher", error: null };
        }
        target.followers_count = args.p_followers_count;
        target.provider_checked_at = args.p_provider_checked_at;
        target.periodic_revalidation_last_terminal_at = args.p_provider_checked_at;
        target.periodic_revalidation_next_due_at = new Date(
          Date.parse(args.p_provider_checked_at) + 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
        target.periodic_revalidation_window_key = null;
        return { data: "updated", error: null };
      }
      target.periodic_revalidation_window_key = null;
      target.periodic_revalidation_next_due_at = new Date(fixedNow.getTime() + 30 * 60 * 1000).toISOString();
      return { data: args.p_outcome, error: null };
    }
    assert.ok([
      "claim_ct_target_verification_jobs",
      "claim_ct_target_evidence_revalidation_jobs_v1",
    ].includes(name));
    const limit = Math.min(Math.max(Number(args.batch_limit) || 5, 1), 10);
    const evidenceOnly = name === "claim_ct_target_evidence_revalidation_jobs_v1";
    const effectiveLimit = Math.min(Math.max(Number(args.p_batch_limit) || limit, 1), 10);
    const workerId = String(args.p_worker_id || args.worker_id || "dashboard_verify_batch");
    const ready = this.jobs.filter((job) => {
      const target = this.targets.find((row) => row.id === job.target_id && row.account_id === job.account_id);
      const expiredProcessing = job.status === "processing" && new Date(job.locked_at) < new Date(fixedNow.getTime() - 15 * 60_000);
      const explicitEvidence = job.metadata_safe?.mode === "evidence_only";
      const safeLegacyEvidence = !job.metadata_safe?.mode
        && job.status === "pending"
        && job.attempt_count === 0
        && new Date(job.created_at) < new Date(fixedNow.getTime() - 7 * 24 * 60 * 60_000)
        && target?.status === "valid"
        && target?.quality_status === "eligible"
        && target?.verification_status === "found";
      return (
        (!evidenceOnly || explicitEvidence || safeLegacyEvidence) &&
        (["pending", "retry_scheduled"].includes(job.status) || expiredProcessing) &&
        (!job.next_attempt_at || new Date(job.next_attempt_at) <= fixedNow) &&
        (!job.locked_at || new Date(job.locked_at) < new Date(fixedNow.getTime() - 15 * 60_000)) &&
        target &&
        target.normalized_username === job.normalized_username &&
        !["archived", "deleted"].includes(target.status) &&
        !target.archived_at &&
        !target.deleted_at
      );
    }).slice(0, effectiveLimit);

    for (const job of ready) {
      job.status = "processing";
      job.attempt_count += 1;
      job.locked_at = fixedNow.toISOString();
      job.locked_by = workerId;
      if (evidenceOnly) {
        job.metadata_safe = {
          ...job.metadata_safe,
          mode: "evidence_only",
          trigger_source: job.metadata_safe?.trigger_source || "legacy_valid_pending",
        };
      }
    }

    return { data: ready.map((job) => ({ ...job })), error: null };
  }
}

function fakeDb(jobs) {
  const targets = jobs.map((job) => ({
    id: job.target_id,
    account_id: job.account_id,
    normalized_username: job.normalized_username,
    status: "pending_verification",
    archived_at: null,
    deleted_at: null,
  }));
  return new FakeSupabase(jobs, targets);
}

function fakePeriodicDb(jobs, targetPatch = {}) {
  const targets = [];
  for (const job of jobs) {
    if (targets.some((target) => target.id === job.target_id && target.account_id === job.account_id)) continue;
    targets.push({
      id: job.target_id,
      account_id: job.account_id,
      normalized_username: job.normalized_username,
      target_username: job.normalized_username,
      canonical_username: job.normalized_username,
      input_username: job.normalized_username,
      status: "valid",
      quality_status: "eligible",
      verification_status: "found",
      metadata_safe: {
        instagram_user_id: "ig-100",
        external_profile_id: "ext-100",
      },
      archived_at: null,
      deleted_at: null,
      periodic_revalidation_next_due_at: "2026-05-29T02:00:00.000Z",
      periodic_revalidation_window_key: null,
      updated_at: "2026-05-20T02:00:00.000Z",
      provider_checked_at: "2026-05-20T02:00:00.000Z",
      followers_count: 800,
      ...targetPatch[job.target_id],
    });
  }
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
    undefined,
  ]);
  assert.equal(db.targets[1].status, "archived");
  assert.equal(db.targets[1].archive_reason, "verified_became_ineligible");
  assert.equal(db.targets[3].status, "pending_verification");
  assert.equal(db.targets[3].archive_reason, undefined);
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
  assert.equal(db.targets[0].status, "pending_verification");
  assert.equal(db.targets[1].status, "pending_verification");
  assert.equal(db.targets[1].quality_status, undefined);
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

test("evidence-only mode refreshes follower evidence without business mutations", async () => {
  const job = pendingJob("evidence", "target_user", {
    batch_id: null,
    metadata_safe: { trigger_source: "periodic_weekly", mode: "evidence_only" },
  });
  const db = fakePeriodicDb([job]);
  const before = {
    status: db.targets[0].status,
    quality_status: db.targets[0].quality_status,
    archived_at: db.targets[0].archived_at,
  };

  const result = await processTargetVerificationBatch(db, {
    mode: "evidence_only",
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({ followers_count: 1200 }),
  });

  assert.equal(result.summary.succeeded_count, 1);
  assert.equal(db.targets[0].followers_count, 1200);
  assert.equal(db.targets[0].provider_checked_at, fixedNow.toISOString());
  assert.deepEqual({
    status: db.targets[0].status,
    quality_status: db.targets[0].quality_status,
    archived_at: db.targets[0].archived_at,
  }, before);
});

test("evidence-only mode excludes legacy pending jobs from claim", async () => {
  const db = fakePeriodicDb([pendingJob("legacy", "target_user", { metadata_safe: {} })]);
  let providerCalls = 0;
  const result = await processTargetVerificationBatch(db, {
    mode: "evidence_only",
    now: () => fixedNow,
    verifyUsername: async () => {
      providerCalls += 1;
      return decisionFromLookup({});
    },
  });
  assert.equal(result.summary.claimed_count, 0);
  assert.equal(providerCalls, 0);
  assert.equal(db.jobs[0].status, "pending");
});

test("old valid legacy pending job is adopted and processed evidence-only", async () => {
  const job = pendingJob("legacy-old", "target_user", {
    created_at: new Date(fixedNow.getTime() - 8 * 24 * 60 * 60_000).toISOString(),
    metadata_safe: {},
  });
  const db = fakePeriodicDb([job]);
  const result = await processTargetVerificationBatch(db, {
    mode: "evidence_only",
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({ followers_count: 1300 }),
  });
  assert.equal(result.summary.succeeded_count, 1);
  assert.equal(db.jobs[0].metadata_safe.mode, "evidence_only");
  assert.equal(db.jobs[0].metadata_safe.trigger_source, "legacy_valid_pending");
  assert.equal(db.targets[0].followers_count, 1300);
  assert.equal(db.targets[0].status, "valid");
});

test("old invalid legacy pending job is not replayed", async () => {
  const job = pendingJob("legacy-invalid", "target_user", {
    created_at: new Date(fixedNow.getTime() - 30 * 24 * 60 * 60_000).toISOString(),
    metadata_safe: {},
  });
  const db = fakePeriodicDb([job], { [job.target_id]: { normalized_username: "other_user" } });
  let providerCalls = 0;
  const result = await processTargetVerificationBatch(db, {
    mode: "evidence_only",
    now: () => fixedNow,
    verifyUsername: async () => {
      providerCalls += 1;
      return decisionFromLookup({});
    },
  });
  assert.equal(result.summary.claimed_count, 0);
  assert.equal(providerCalls, 0);
  assert.equal(db.jobs[0].status, "pending");
});

test("evidence-only identity mismatch fails closed without follower overwrite", async () => {
  const job = pendingJob("mismatch", "target_user", {
    batch_id: null,
    metadata_safe: { trigger_source: "periodic_weekly", mode: "evidence_only" },
  });
  const db = fakePeriodicDb([job]);
  const result = await processTargetVerificationBatch(db, {
    mode: "evidence_only",
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({ canonical_username: "other_user", followers_count: 9999 }),
  });
  assert.equal(db.targets[0].followers_count, 800);
  assert.equal(db.jobs[0].status, "failed");
  assert.equal(db.jobs[0].last_error_code, "identity_mismatch");
  assert.equal(result.summary.skipped_count, 1);
});

test("evidence-only lookup failure never advances provider freshness", async () => {
  const job = pendingJob("not-found-evidence", "target_user", {
    batch_id: null,
    metadata_safe: { trigger_source: "periodic_weekly", mode: "evidence_only" },
  });
  const db = fakePeriodicDb([job]);
  const beforeCheckedAt = db.targets[0].provider_checked_at;
  await processTargetVerificationBatch(db, {
    mode: "evidence_only",
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({
      ok: false,
      status: "not_found",
      reason: "not_found",
      followers_count: null,
    }),
  });
  assert.equal(db.targets[0].provider_checked_at, beforeCheckedAt);
  assert.equal(db.targets[0].followers_count, 800);
  assert.equal(db.targets[0].status, "valid");
  assert.equal(db.targets[0].archived_at, null);
});

test("evidence-only stale provider response cannot overwrite newer evidence", async () => {
  const job = pendingJob("stale-evidence", "target_user", {
    batch_id: null,
    metadata_safe: { trigger_source: "periodic_weekly", mode: "evidence_only" },
  });
  const newer = new Date(fixedNow.getTime() + 60_000).toISOString();
  const db = fakePeriodicDb([job], {
    [job.target_id]: { provider_checked_at: newer, followers_count: 1500 },
  });
  const result = await processTargetVerificationBatch(db, {
    mode: "evidence_only",
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({ followers_count: 100 }),
  });
  assert.equal(result.summary.succeeded_count, 1);
  assert.equal(db.targets[0].provider_checked_at, newer);
  assert.equal(db.targets[0].followers_count, 1500);
});

test("evidence-only rate limit preserves target and requeues without fake freshness", async () => {
  const job = pendingJob("rate-evidence", "target_user", {
    batch_id: null,
    metadata_safe: { trigger_source: "periodic_weekly", mode: "evidence_only" },
  });
  const db = fakePeriodicDb([job]);
  const before = { ...db.targets[0] };
  const result = await processTargetVerificationBatch(db, {
    mode: "evidence_only",
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({
      ok: false,
      status: "rate_limited",
      reason: "rate_limited",
      metadata: { rate_limited: true },
    }),
  });
  assert.equal(result.summary.rate_limited_count, 1);
  assert.equal(db.jobs[0].status, "retry_scheduled");
  assert.equal(db.targets[0].provider_checked_at, before.provider_checked_at);
  assert.equal(db.targets[0].followers_count, before.followers_count);
  assert.equal(db.targets[0].status, before.status);
});

test("periodic weekly terminal success advances next due by exactly seven days", async () => {
  const db = fakePeriodicDb([pendingJob("1", "eligible_one", { batch_id: "periodic_weekly:482148" })]);
  const result = await processTargetVerificationBatch(db, {
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({}),
  });

  assert.equal(result.summary.succeeded_count, 1);
  assert.equal(db.targets[0].periodic_revalidation_last_terminal_at, fixedNow.toISOString());
  assert.equal(
    Date.parse(db.targets[0].periodic_revalidation_next_due_at) - fixedNow.getTime(),
    7 * 24 * 60 * 60 * 1000,
  );
  assert.equal(db.targets[0].periodic_revalidation_window_key, null);
});

test("periodic weekly rate limit does not advance schedule or archive target", async () => {
  const db = fakePeriodicDb([pendingJob("1", "rate_one", { batch_id: "periodic_weekly:482148" })]);
  const before = { ...db.targets[0] };
  await processTargetVerificationBatch(db, {
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({
      ok: false,
      status: "rate_limited",
      reason: "rate_limited",
      metadata: { rate_limited: true },
    }),
  });

  assert.equal(db.jobs[0].status, "retry_scheduled");
  assert.equal(db.targets[0].status, before.status);
  assert.equal(db.targets[0].periodic_revalidation_next_due_at, before.periodic_revalidation_next_due_at);
  assert.equal(db.targets[0].archived_at, before.archived_at);
});

test("first periodic not_found records evidence and schedules confirmation without archive", async () => {
  const db = fakePeriodicDb([pendingJob("1", "missing_user", { batch_id: "periodic_weekly:482148" })]);
  let providerCalls = 0;
  const verifyUsername = async () => {
    providerCalls += 1;
    return decisionFromLookup({
      ok: false,
      status: "not_found",
      reason: "not_found",
      followers_count: null,
    });
  };
  await processTargetVerificationBatch(db, {
    now: () => fixedNow,
    verifyUsername,
  });

  assert.equal(db.targets[0].status, "valid");
  assert.equal(db.targets[0].archive_reason, undefined);
  assert.equal(db.jobs[0].provider_status, "not_found");
  assert.equal(
    Date.parse(db.targets[0].periodic_revalidation_next_due_at) - fixedNow.getTime(),
    30 * 60 * 1000,
  );
  assert.equal(db.targets[0].periodic_revalidation_window_key, null);
  const replay = await processTargetVerificationBatch(db, { now: () => fixedNow, verifyUsername });
  assert.equal(replay.summary.claimed_count, 0);
  assert.equal(providerCalls, 1);
  assert.equal(db.targets[0].status, "valid");
});

test("canonical unavailable confirmation permits archive with the stable reason", async () => {
  const targetId = "target-current";
  const prior = pendingJob("prior", "missing_user", {
    target_id: targetId,
    status: "succeeded",
    provider_status: "not_found",
    updated_at: new Date(fixedNow.getTime() - 20 * 60 * 1000).toISOString(),
  });
  const current = pendingJob("current", "missing_user", {
    target_id: targetId,
    batch_id: "periodic_weekly:482149",
  });
  const db = fakePeriodicDb([prior, current]);
  db.availabilityCurrent.push({
    target_id: targetId,
    account_id: "account-1",
    availability_status: "unavailable_confirmed",
    confidence: "high",
    identity_status: "identity_confirmed",
    confirmed_at: new Date(fixedNow.getTime() - 10 * 60 * 1000).toISOString(),
    valid_until: new Date(fixedNow.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  });
  await processTargetVerificationBatch(db, {
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({
      ok: false,
      status: "not_found",
      reason: "not_found",
      followers_count: null,
    }),
  });

  assert.equal(db.targets[0].status, "archived");
  assert.equal(db.targets[0].archive_reason, "account_not_found");
  assert.equal(db.targets[0].periodic_revalidation_next_due_at, null);
});

test("stale, weak, or identity-conflicted canonical confirmation fails closed", async () => {
  for (const currentPatch of [
    { confidence: "low" },
    { valid_until: new Date(fixedNow.getTime() - 1).toISOString() },
    { identity_status: "identity_conflict" },
    { confirmed_at: null },
  ]) {
    const job = pendingJob(`current-${JSON.stringify(currentPatch)}`, "missing_user");
    const db = fakePeriodicDb([job]);
    db.availabilityCurrent.push({
      target_id: job.target_id,
      account_id: job.account_id,
      availability_status: "unavailable_confirmed",
      confidence: "high",
      identity_status: "identity_confirmed",
      confirmed_at: new Date(fixedNow.getTime() - 10 * 60 * 1000).toISOString(),
      valid_until: new Date(fixedNow.getTime() + 12 * 60 * 60 * 1000).toISOString(),
      ...currentPatch,
    });
    await processTargetVerificationBatch(db, {
      now: () => fixedNow,
      verifyUsername: async () => decisionFromLookup({
        ok: false,
        status: "not_found",
        reason: "not_found",
        followers_count: null,
      }),
    });
    assert.equal(db.targets[0].status, "valid");
  }
});

test("repeated verification jobs cannot bypass missing canonical confirmation", async () => {
  const targetId = "target-current";
  const prior = pendingJob("prior", "missing_user", {
    target_id: targetId,
    batch_id: "same-observation-batch",
    status: "succeeded",
    provider_status: "not_found",
    updated_at: new Date(fixedNow.getTime() - 20 * 60 * 1000).toISOString(),
  });
  const current = pendingJob("current", "missing_user", {
    target_id: targetId,
    batch_id: "same-observation-batch",
  });
  const db = fakePeriodicDb([prior, current]);
  await processTargetVerificationBatch(db, {
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({
      ok: false,
      status: "not_found",
      reason: "not_found",
      followers_count: null,
    }),
  });

  assert.equal(db.targets[0].status, "valid");
  assert.equal(db.targets[0].archive_reason, undefined);
});

test("a recovered target between not_found observations resets confirmation", async () => {
  const targetId = "target-current";
  const oldMissing = pendingJob("old-missing", "missing_user", {
    target_id: targetId,
    status: "succeeded",
    provider_status: "not_found",
    updated_at: new Date(fixedNow.getTime() - 40 * 60 * 1000).toISOString(),
  });
  const recovered = pendingJob("recovered", "missing_user", {
    target_id: targetId,
    status: "succeeded",
    provider_status: "found",
    updated_at: new Date(fixedNow.getTime() - 10 * 60 * 1000).toISOString(),
  });
  const current = pendingJob("current", "missing_user", { target_id: targetId });
  const db = fakePeriodicDb([oldMissing, recovered, current]);
  db.availabilityCurrent.push({
    target_id: targetId,
    account_id: "account-1",
    availability_status: "available",
    confidence: "high",
    identity_status: "identity_confirmed",
    confirmed_at: new Date(fixedNow.getTime() - 5 * 60 * 1000).toISOString(),
    valid_until: new Date(fixedNow.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  });
  await processTargetVerificationBatch(db, {
    now: () => fixedNow,
    verifyUsername: async () => decisionFromLookup({
      ok: false,
      status: "not_found",
      reason: "not_found",
      followers_count: null,
    }),
  });

  assert.equal(db.targets[0].status, "valid");
  assert.equal(db.targets[0].archive_reason, undefined);
});
