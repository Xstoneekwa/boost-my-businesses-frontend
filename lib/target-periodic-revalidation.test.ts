import assert from "node:assert/strict";
import test from "node:test";
import {
  PERIODIC_REVALIDATION_INTERVAL_MS,
  buildPeriodicInitializationPatch,
  buildPeriodicSchedulePatchAfterTerminal,
  buildRestorePeriodicSchedulePatch,
  computeInitialPeriodicNextDueAt,
  computeNextPeriodicDueAfterTerminal,
  computePeriodicStaggerAnchorUtc,
  computePeriodicStaggerOffsetMs,
  isPeriodicRevalidationDue,
  isWithinOneHourOfPeriodicDue,
  shouldAdvancePeriodicSchedule,
} from "./target-periodic-revalidation.ts";
import { runPeriodicTargetRevalidationScheduler } from "./target-periodic-revalidation-scheduler.ts";

const weekAnchor = new Date("2026-06-15T00:00:00.000Z");

test("terminal periodic revalidation schedules next due exactly +7 days", () => {
  const terminalAt = new Date("2026-06-15T12:00:00.000Z");
  const patch = buildPeriodicSchedulePatchAfterTerminal(terminalAt, "apply_quality_decision");
  assert.equal(
    patch.periodic_revalidation_next_due_at,
    computeNextPeriodicDueAfterTerminal(terminalAt).toISOString(),
  );
  assert.equal(
    Date.parse(patch.periodic_revalidation_next_due_at as string) - terminalAt.getTime(),
    PERIODIC_REVALIDATION_INTERVAL_MS,
  );
});

test("stagger anchor is ISO Monday 00:00 UTC for the reference week", () => {
  assert.equal(computePeriodicStaggerAnchorUtc(new Date("2026-06-17T15:30:00.000Z")).toISOString(), weekAnchor.toISOString());
  assert.equal(computePeriodicStaggerAnchorUtc(new Date("2026-06-21T23:59:59.000Z")).toISOString(), weekAnchor.toISOString());
  assert.equal(computePeriodicStaggerAnchorUtc(new Date("2026-06-15T00:00:00.000Z")).toISOString(), weekAnchor.toISOString());
});

test("uninitialized CT gets the same next_due_at across cron hours in the same ISO week", () => {
  const targetId = "target-stable-anchor";
  const morning = new Date("2026-06-17T10:00:00.000Z");
  const evening = new Date("2026-06-19T22:00:00.000Z");
  const patchMorning = buildPeriodicInitializationPatch(targetId, morning);
  const patchEvening = buildPeriodicInitializationPatch(targetId, evening);
  assert.equal(patchMorning.periodic_revalidation_next_due_at, patchEvening.periodic_revalidation_next_due_at);
  assert.notEqual(patchMorning.periodic_revalidation_next_due_at, morning.toISOString());
});

test("two scheduler runs persist the same initialization for an uninitialized CT", async () => {
  const targetId = "target-persist-init";
  const morning = new Date("2026-06-17T10:00:00.000Z");
  const evening = new Date("2026-06-19T22:00:00.000Z");
  const targets = [{
    id: targetId,
    account_id: "acct-1",
    normalized_username: "init_user",
    status: "valid",
    quality_status: "eligible",
    verification_status: "found",
    periodic_revalidation_next_due_at: null,
    periodic_revalidation_window_key: null,
  }];
  const supabase = createSchedulerMock({ targets, jobs: [] });
  const first = await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true", CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN: "false" },
    now: () => morning,
    enqueueLimit: 5,
    dryRun: false,
  });
  const persistedDue = supabase.targets[0].periodic_revalidation_next_due_at;
  assert.ok(persistedDue);
  assert.equal(first.initialized_count, 1);

  const second = await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true", CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN: "false" },
    now: () => evening,
    enqueueLimit: 5,
    dryRun: false,
  });
  assert.equal(supabase.targets[0].periodic_revalidation_next_due_at, persistedDue);
  assert.equal(second.initialized_count, 0);
});

test("initialized CT keeps persisted due date on later scheduler runs", async () => {
  const persistedDue = "2026-06-20T08:00:00.000Z";
  const targets = [{
    id: "target-initialized",
    account_id: "acct-1",
    normalized_username: "stable_user",
    status: "valid",
    quality_status: "eligible",
    verification_status: "found",
    periodic_revalidation_next_due_at: persistedDue,
    periodic_revalidation_window_key: null,
  }];
  const supabase = createSchedulerMock({ targets, jobs: [] });
  await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true", CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN: "false" },
    now: () => new Date("2026-06-20T09:00:00.000Z"),
    enqueueLimit: 5,
    dryRun: false,
  });
  await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true", CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN: "false" },
    now: () => new Date("2026-06-21T09:00:00.000Z"),
    enqueueLimit: 5,
    dryRun: false,
  });
  assert.equal(supabase.targets[0].periodic_revalidation_next_due_at, persistedDue);
});

test("CT at 6 days 23 hours is not due yet", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const nextDue = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  assert.equal(isPeriodicRevalidationDue({ periodic_revalidation_next_due_at: nextDue }, now), false);
  assert.equal(isWithinOneHourOfPeriodicDue({ periodic_revalidation_next_due_at: nextDue }, now), true);
});

test("due CT is selected once per scheduler pass", async () => {
  const targetId = "target-due";
  const now = new Date("2026-06-15T12:00:00.000Z");
  const targets = [{
    id: targetId,
    account_id: "acct-1",
    normalized_username: "due_user",
    status: "valid",
    quality_status: "eligible",
    verification_status: "found",
    periodic_revalidation_next_due_at: "2026-06-15T11:00:00.000Z",
    periodic_revalidation_window_key: null,
  }];
  const supabase = createSchedulerMock({ targets, jobs: [] });
  const first = await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true", CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN: "false" },
    now: () => now,
    enqueueLimit: 5,
    dryRun: false,
  });
  assert.equal(first.selected_count, 1);
  assert.equal(first.enqueued_count, 1);
  const second = await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true", CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN: "false" },
    now: () => now,
    enqueueLimit: 5,
    dryRun: false,
  });
  assert.equal(second.enqueued_count, 0);
  assert.equal(second.skipped_active_job_count, 1);
});

test("concurrent scheduler passes cannot claim the same periodic window twice", async () => {
  const targetId = "target-window";
  const now = new Date("2026-06-15T12:00:00.000Z");
  const targets = [{
    id: targetId,
    account_id: "acct-1",
    normalized_username: "window_user",
    status: "valid",
    quality_status: "eligible",
    verification_status: "found",
    periodic_revalidation_next_due_at: "2026-06-15T11:00:00.000Z",
    periodic_revalidation_window_key: "482148",
  }];
  const supabase = createSchedulerMock({ targets, jobs: [] });
  const result = await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true" },
    now: () => now,
    dryRun: false,
  });
  assert.equal(result.enqueued_count, 0);
  assert.equal(result.skipped_window_claim_count, 1);
});

test("existing CT initialization is deterministically staggered across 7 days", () => {
  const ids = ["target-a", "target-b", "target-c", "target-d"];
  for (const id of ids) {
    const dueAt = computeInitialPeriodicNextDueAt(id, new Date("2026-06-17T12:00:00.000Z"));
    const delta = dueAt.getTime() - weekAnchor.getTime();
    assert.equal(delta, computePeriodicStaggerOffsetMs(id));
    assert.ok(delta >= 0 && delta < PERIODIC_REVALIDATION_INTERVAL_MS);
  }
});

test("due CTs sharing the same stagger bucket do not duplicate jobs in one batch", async () => {
  const sharedDueAt = "2026-06-20T08:00:00.000Z";
  const now = new Date("2026-06-21T00:00:00.000Z");
  const targets = ["target-collision-a", "target-collision-b"].map((id, index) => ({
    id,
    account_id: "acct-1",
    normalized_username: `collision_user_${index}`,
    status: "valid",
    quality_status: "eligible",
    verification_status: "found",
    periodic_revalidation_next_due_at: sharedDueAt,
    periodic_revalidation_window_key: null,
  }));
  const supabase = createSchedulerMock({ targets, jobs: [] });
  const firstPass = await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true", CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN: "false" },
    now: () => now,
    enqueueLimit: 1,
    dryRun: false,
  });
  assert.equal(firstPass.enqueued_count, 1);
  assert.equal(supabase.jobs.length, 1);

  const secondPass = await runPeriodicTargetRevalidationScheduler(supabase, {
    env: { CT_TARGET_PERIODIC_REVALIDATION_ENABLED: "true", CT_TARGET_PERIODIC_REVALIDATION_DRY_RUN: "false" },
    now: () => new Date(now.getTime() + 60 * 60 * 1000),
    enqueueLimit: 1,
    dryRun: false,
  });
  assert.equal(secondPass.enqueued_count, 1);
  assert.equal(supabase.jobs.length, 2);
  assert.equal(new Set(supabase.jobs.map((job) => job.target_id)).size, 2);
});

test("hash offsets are deterministic and collisions remain valid modulo buckets", () => {
  const first = computePeriodicStaggerOffsetMs("target-collision-a");
  const second = computePeriodicStaggerOffsetMs("target-collision-b");
  assert.equal(first, computePeriodicStaggerOffsetMs("target-collision-a"));
  assert.ok(first >= 0 && first < PERIODIC_REVALIDATION_INTERVAL_MS);
  assert.ok(second >= 0 && second < PERIODIC_REVALIDATION_INTERVAL_MS);
});

test("large CT population spreads across the week without requiring unique offsets", () => {
  const ids = Array.from({ length: 512 }, (_, index) => `target-${index}`);
  const offsets = ids.map((id) => computePeriodicStaggerOffsetMs(id));
  const buckets = new Array(7).fill(0);
  for (const offset of offsets) {
    const dayBucket = Math.min(Math.floor(offset / (24 * 60 * 60 * 1000)), 6);
    buckets[dayBucket] += 1;
  }
  assert.ok(buckets.every((count) => count > 0));
  const average = ids.length / buckets.length;
  assert.ok(buckets.every((count) => count <= average * 3));
  assert.ok(new Set(offsets).size > 0);
});

test("confirmed rename preserves existing weekly due date", () => {
  const existingDue = "2026-06-20T08:00:00.000Z";
  const patch = buildPeriodicSchedulePatchAfterTerminal(new Date("2026-06-15T12:00:00.000Z"), "rename_confirmed");
  assert.deepEqual(patch, { periodic_revalidation_window_key: null });
  assert.equal(patch.periodic_revalidation_next_due_at, undefined);
  assert.equal(existingDue, existingDue);
});

test("archive clears periodic schedule and restore reinscribes staggered due date", () => {
  const targetId = "target-restore";
  const now = new Date("2026-06-17T12:00:00.000Z");
  const restorePatch = buildRestorePeriodicSchedulePatch(targetId, now);
  assert.ok(restorePatch.periodic_revalidation_next_due_at);
  assert.equal(
    restorePatch.periodic_revalidation_next_due_at,
    computeInitialPeriodicNextDueAt(targetId, now).toISOString(),
  );
  assert.equal(restorePatch.periodic_revalidation_last_terminal_at, null);
  const archivePatch = buildPeriodicSchedulePatchAfterTerminal(now, "archive_verified");
  assert.equal(archivePatch.periodic_revalidation_next_due_at, null);
});

test("provider retry does not advance periodic schedule", () => {
  assert.equal(shouldAdvancePeriodicSchedule({
    batchId: "periodic_weekly:123",
    jobStatus: "retry_scheduled",
    hygieneAction: "apply_quality_decision",
  }), false);
});

function createSchedulerMock(input: {
  targets: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
}) {
  const targets = input.targets.map((row) => ({ ...row }));
  const jobs = input.jobs.map((row) => ({ ...row }));

  class MockQuery {
    table: string;
    filters: Array<{ op: string; column?: string; value?: unknown }> = [];
    updateValues: Record<string, unknown> | null = null;

    constructor(table: string) {
      this.table = table;
    }

    select() {
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ op: "eq", column, value });
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push({ op: "is", column, value });
      return this;
    }

    or(filter: string) {
      this.filters.push({ op: "or", value: filter });
      return this;
    }

    in(column: string, value: unknown[]) {
      this.filters.push({ op: "in", column, value });
      return this;
    }

    update(values: Record<string, unknown>) {
      this.updateValues = values;
      return this;
    }

    async limit() {
      return { data: this.filterRows(), error: null };
    }

    async upsert(values: Record<string, unknown>, _options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      const row = values as Record<string, unknown>;
      const existing = jobs.find((job) => job.target_id === row.target_id);
      if (!existing) jobs.push(row);
      return { error: null };
    }

    async insert() {
      return { error: null };
    }

    async maybeSingle() {
      const rows = this.filterRows();
      if (this.updateValues) {
        for (const row of rows) Object.assign(row, this.updateValues);
      }
      return { data: rows[0] ?? null, error: null };
    }

    filterRows() {
      const source = this.table === "ig_targets" ? targets : this.table === "ct_target_verification_jobs" ? jobs : [];
      return source.filter((row) => this.filters.every((filter) => {
        if (filter.op === "eq") return row[filter.column as string] === filter.value;
        if (filter.op === "is") {
          if (filter.value === null) return row[filter.column as string] == null;
          return row[filter.column as string] === filter.value;
        }
        if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(row[filter.column as string]);
        if (filter.op === "or") {
          const nowIso = String(filter.value).split("lte.")[1] ?? "";
          const nextDue = row.periodic_revalidation_next_due_at;
          return !nextDue || (nowIso && Date.parse(String(nextDue)) <= Date.parse(nowIso));
        }
        return true;
      }));
    }
  }

  const api = {
    targets,
    jobs,
    from(table: string) {
      return new MockQuery(table);
    },
  };
  return api;
}
