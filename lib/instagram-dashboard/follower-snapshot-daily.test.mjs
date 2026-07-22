import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planDailyFollowerSnapshots, runDailyFollowerSnapshotCollection } from "./follower-snapshot-daily.ts";
import { followerSnapshotId } from "./follower-snapshot-collector.ts";
import { socialProfileSnapshotsEnabled } from "./social-profile-snapshot-rollout.ts";

const accounts = [
  { id: "tracker", username: "i_m_your_traker" },
  { id: "mythyl", username: "mythyl_fitness" },
];
const snapshots = [
  {
    id: "tracker-baseline",
    account_id: "tracker",
    followers_count: 28,
    captured_at: "2026-06-19T23:59:57.077Z",
    source: "public_profile_lookup",
    observation_kind: "baseline",
    created_at: "2026-06-19T23:59:57.339Z",
  },
];

test("daily plan keeps Tracker baseline and schedules daily while Mythyl receives first baseline", () => {
  const plan = planDailyFollowerSnapshots({
    accounts,
    snapshots,
    now: new Date("2026-07-14T00:30:00.000Z"),
  });
  assert.deepEqual(plan.map(({ id, action, reason }) => ({ id, action, reason })), [
    { id: "tracker", action: "daily", reason: "daily_snapshot_due" },
    { id: "mythyl", action: "baseline", reason: "first_snapshot" },
  ]);
});

test("same SAST business day is idempotently skipped", () => {
  const plan = planDailyFollowerSnapshots({
    accounts: [accounts[0]],
    snapshots: [{ ...snapshots[0], captured_at: "2026-07-13T23:45:00.000Z", observation_kind: "daily" }],
    now: new Date("2026-07-14T00:30:00.000Z"),
  });
  assert.equal(plan[0].action, "skip");
  assert.equal(plan[0].reason, "already_collected_today");
});

test("snapshot identity is stable per account and SAST business day", () => {
  assert.equal(
    followerSnapshotId("mythyl", "2026-07-20T23:59:00.000Z"),
    followerSnapshotId("mythyl", "2026-07-21T20:00:00.000Z"),
  );
  assert.notEqual(
    followerSnapshotId("mythyl", "2026-07-21T20:00:00.000Z"),
    followerSnapshotId("mythyl", "2026-07-21T22:01:00.000Z"),
  );
});

test("a concurrent duplicate write is reconciled as skipped, not inserted", async () => {
  const result = await runDailyFollowerSnapshotCollection({
    now: new Date("2026-07-21T20:00:00.000Z"),
    dependencies: {
      listAccounts: async () => [accounts[1]],
      loadSnapshots: async () => [],
      collect: async () => ({
        ok: true,
        followersCount: 100,
        source: "public_profile_lookup",
        capturedAt: "2026-07-21T20:00:01.000Z",
      }),
      insert: async (input) => ({
        ok: true,
        created: false,
        row: {
          id: followerSnapshotId(input.accountId, input.capturedAt),
          account_id: input.accountId,
          followers_count: input.followersCount,
          captured_at: input.capturedAt,
          source: input.source,
          observation_kind: input.observationKind,
        },
      }),
    },
  });
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.results[0].reason, "snapshot_already_exists");
});

test("cron dry-run reads the plan without lookup or snapshot insertion", async () => {
  let externalCalls = 0;
  const result = await runDailyFollowerSnapshotCollection({
    dryRun: true,
    now: new Date("2026-07-14T00:30:00.000Z"),
    dependencies: {
      listAccounts: async () => accounts,
      loadSnapshots: async () => snapshots,
      collect: async () => {
        externalCalls += 1;
        throw new Error("dry-run performed public lookup");
      },
      insert: async () => {
        externalCalls += 1;
        throw new Error("dry-run inserted a snapshot");
      },
    },
  });
  assert.equal(externalCalls, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.inserted, 0);
  assert.equal(result.plan.length, 2);
});

test("daily execution inserts one Tracker daily snapshot and one Mythyl baseline", async () => {
  const insertedKinds = [];
  const result = await runDailyFollowerSnapshotCollection({
    now: new Date("2026-07-14T00:30:00.000Z"),
    dependencies: {
      listAccounts: async () => accounts,
      loadSnapshots: async () => snapshots,
      collect: async (username) => ({
        ok: true,
        followersCount: username === "i_m_your_traker" ? 29 : 100,
        source: "public_profile_lookup",
        capturedAt: "2026-07-14T00:30:01.000Z",
      }),
      insert: async (input) => {
        insertedKinds.push({ accountId: input.accountId, kind: input.observationKind });
        return {
          ok: true,
          row: {
            id: `snapshot-${input.accountId}`,
            account_id: input.accountId,
            followers_count: input.followersCount,
            captured_at: input.capturedAt,
            source: input.source,
            observation_kind: input.observationKind,
          },
        };
      },
    },
  });
  assert.equal(result.inserted, 2);
  assert.deepEqual(insertedKinds, [
    { accountId: "tracker", kind: "daily" },
    { accountId: "mythyl", kind: "baseline" },
  ]);
});

test("durable trace records success, failure, skip, and final reconciliation", async () => {
  const runWrites = [];
  const accountWrites = [];
  const trace = {
    async writeRun(input) { runWrites.push(input); },
    async writeAccount(runId, input) { accountWrites.push({ runId, ...input }); },
  };
  const traceAccounts = [
    { id: "success", username: "success_user" },
    { id: "failed", username: "failed_user" },
    { id: "skipped", username: "skipped_user" },
  ];
  const result = await runDailyFollowerSnapshotCollection({
    now: new Date("2026-07-21T00:30:00.000Z"),
    dependencies: {
      trace,
      listAccounts: async () => traceAccounts,
      loadSnapshots: async () => [{
        id: "same-day",
        account_id: "skipped",
        followers_count: 9,
        captured_at: "2026-07-20T23:45:00.000Z",
        source: "public_profile_lookup",
        observation_kind: "daily",
      }],
      collect: async (username) => username === "failed_user"
        ? { ok: false, reason: "provider_timeout", sourceAttempted: "public_profile_lookup" }
        : { ok: true, followersCount: 12, source: "public_profile_lookup", capturedAt: "2026-07-21T00:30:02.000Z" },
      insert: async (input) => ({
        ok: true,
        row: {
          id: `snapshot-${input.accountId}`,
          account_id: input.accountId,
          followers_count: input.followersCount,
          captured_at: input.capturedAt,
          source: input.source,
          observation_kind: input.observationKind,
        },
      }),
    },
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(accountWrites.map((row) => row.status).sort(), ["failed", "skipped", "succeeded"]);
  assert.equal(runWrites[0].status, "running");
  assert.deepEqual(runWrites.at(-1), {
    ...runWrites.at(-1),
    status: "partial",
    accountsSelected: 3,
    accountsSucceeded: 1,
    accountsFailed: 1,
    accountsSkipped: 1,
    failureReason: "provider_timeout",
  });
});

test("cron scans hourly for session-end jobs and exposes an authenticated dry-run", () => {
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
  const route = readFileSync(new URL("../../app/api/cron/instagram-follower-snapshots/route.ts", import.meta.url), "utf8");
  assert.deepEqual(vercel.crons.find((cron) => cron.path === "/api/cron/instagram-follower-snapshots"), {
    path: "/api/cron/instagram-follower-snapshots",
    schedule: "17 * * * *",
  });
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /SOCIAL_PROFILE_SNAPSHOTS_ENABLED/);
  assert.match(route, /socialProfileSnapshotsEnabled/);
  assert.match(route, /status: "skipped_disabled"/);
  assert.match(route, /providerCalls: 0/);
  assert.match(route, /jobsCreated: 0/);
  assert.match(route, /jobsProcessed: 0/);
  assert.match(route, /dry_run/);
  assert.match(route, /enqueueDailySocialProfileSnapshotJobs/);
  assert.match(route, /processSocialProfileSnapshotJobs/);
  assert.match(route, /writes: 0,[\s\S]*providerCalls: 0/);
  assert.match(route, /classifyAutomaticSocialProfileSnapshotJobs/);
});

test("social profile rollout defaults disabled and only exact true enables it", () => {
  assert.equal(socialProfileSnapshotsEnabled(undefined), false);
  assert.equal(socialProfileSnapshotsEnabled("false"), false);
  assert.equal(socialProfileSnapshotsEnabled("TRUE"), false);
  assert.equal(socialProfileSnapshotsEnabled("true"), true);
});
