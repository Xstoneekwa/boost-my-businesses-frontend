import assert from "node:assert/strict";
import test from "node:test";
import {
  createFollowerCollectorTraceWriter,
  followerCollectorRunId,
  sanitizeFollowerCollectorFailureReason,
} from "./follower-snapshot-runtime-trace.ts";

function mockSupabase() {
  const rows = new Map();
  return {
    rows,
    client: {
      from(table) {
        assert.equal(table, "runtime_events");
        return {
          async upsert(row, options) {
            assert.deepEqual(options, { onConflict: "id" });
            rows.set(row.id, row);
            return { error: null };
          },
        };
      },
    },
  };
}

test("collector run id is deterministic for one scheduled execution", () => {
  const scheduledAt = "2026-07-21T00:30:00.000Z";
  assert.equal(followerCollectorRunId(scheduledAt), followerCollectorRunId(scheduledAt));
  assert.match(followerCollectorRunId(scheduledAt), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("runtime event upserts are idempotent for run and account", async () => {
  const { rows, client } = mockSupabase();
  const writer = createFollowerCollectorTraceWriter(client);
  const collectorRunId = followerCollectorRunId("2026-07-21T00:30:00.000Z");
  const baseRun = {
    collectorRunId,
    scheduledAt: "2026-07-21T00:30:00.000Z",
    startedAt: "2026-07-21T00:30:01.000Z",
    completedAt: null,
    status: "running",
    accountsSelected: 0,
    accountsSucceeded: 0,
    accountsFailed: 0,
    accountsSkipped: 0,
    provider: "public_profile_lookup",
    failureReason: null,
  };
  await writer.writeRun(baseRun);
  await writer.writeRun({ ...baseRun, completedAt: "2026-07-21T00:31:00.000Z", status: "succeeded", accountsSelected: 1, accountsSucceeded: 1 });
  await writer.writeAccount(collectorRunId, {
    accountId: "mythyl",
    accountUsername: "mythyl_fitness",
    attemptedAt: "2026-07-21T00:30:02.000Z",
    status: "succeeded",
    followersCount: 14,
    provider: "public_profile_lookup",
    failureReason: null,
    snapshotWritten: true,
    snapshotTimestamp: "2026-07-21T00:30:02.000Z",
  });
  await writer.writeAccount(collectorRunId, {
    accountId: "mythyl",
    accountUsername: "mythyl_fitness",
    attemptedAt: "2026-07-21T00:30:02.000Z",
    status: "succeeded",
    followersCount: 14,
    provider: "public_profile_lookup",
    failureReason: null,
    snapshotWritten: true,
    snapshotTimestamp: "2026-07-21T00:30:02.000Z",
  });
  assert.equal(rows.size, 2);
  assert.deepEqual([...rows.values()].map((row) => row.event_type).sort(), [
    "follower_snapshot_collector_account",
    "follower_snapshot_collector_run",
  ]);
  assert.equal([...rows.values()].find((row) => row.event_type === "follower_snapshot_collector_run").metadata.status, "succeeded");
});

test("failure reasons redact secrets and raw URLs", () => {
  const sanitized = sanitizeFollowerCollectorFailureReason("token=abc123 https://provider.test/raw\nfailed");
  assert.doesNotMatch(sanitized, /abc123|provider\.test/);
  assert.match(sanitized, /\[redacted\]/);
});

test("manual validation context is recorded with controlled labels", async () => {
  const { rows, client } = mockSupabase();
  const writer = createFollowerCollectorTraceWriter(client, {
    triggerSource: "manual_validation",
    requestedBy: "controlled_review",
    requestedDeploymentSha: "a".repeat(40),
  });
  await writer.writeRun({
    collectorRunId: followerCollectorRunId("2026-07-21T00:30:00.000Z"),
    scheduledAt: "2026-07-21T00:30:00.000Z",
    startedAt: "2026-07-21T20:00:00.000Z",
    completedAt: null,
    status: "running",
    accountsSelected: 0,
    accountsSucceeded: 0,
    accountsFailed: 0,
    accountsSkipped: 0,
    provider: "public_profile_lookup",
    failureReason: null,
  });
  const event = [...rows.values()][0];
  assert.equal(event.metadata.trigger_source, "manual_validation");
  assert.equal(event.metadata.requested_by, "controlled_review");
  assert.equal(event.metadata.requested_deployment_sha, "a".repeat(40));
});
