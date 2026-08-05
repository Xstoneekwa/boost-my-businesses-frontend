import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260805120000_follow_persistence_live_run_counter_v2.sql", import.meta.url),
  "utf8",
);

const rollback = readFileSync(
  new URL("../rollback/20260805120000_follow_persistence_live_run_counter_v2.down.sql", import.meta.url),
  "utf8",
);

test("new verified Follow increments the exact run and returns its monotonic revision", () => {
  assert.match(migration, /where r\.id = p_run_id and r\.account_id = p_account_id/i);
  assert.match(migration, /total_follow = coalesce\(r\.total_follow, 0\) \+ 1/i);
  assert.match(migration, /returning r\.total_follow, r\.live_counter_revision/i);
  assert.match(migration, /'run_total_follow', v_run_total_follow/i);
  assert.match(migration, /'live_counter_revision', v_live_counter_revision/i);
  assert.match(migration, /'run_live_counter_revision_advanced'/i);
});

test("idempotent replay returns before the live run increment", () => {
  const replayReturn = migration.indexOf("'status', 'idempotent_replay'");
  const runIncrement = migration.indexOf("total_follow = coalesce(r.total_follow, 0) + 1");
  assert.ok(replayReturn >= 0);
  assert.ok(runIncrement > replayReturn);
  assert.match(
    migration,
    /'status', 'idempotent_replay'[\s\S]*?'run_total_follow'[\s\S]*?'live_counter_revision'/i,
  );
});

test("run row is locked before action idempotency and all relations stay schema-qualified", () => {
  assert.match(
    migration,
    /select r\.\* into v_run[\s\S]*?from public\.ig_runs as r[\s\S]*?for update/i,
  );
  assert.match(migration, /SET "search_path" TO ''/i);
  for (const relation of [
    "account_run_requests",
    "ig_runs",
    "ig_targets",
    "ig_interaction_events",
    "ig_account_unfollow_settings",
    "ig_interacted_users",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`\\b(?:from|into|update)\\s+${relation}\\b`, "i"));
  }
});

test("RPC remains service-role only", () => {
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});

test("rollback restores the pre-live-counter RPC contract without dropping revision infrastructure", () => {
  assert.doesNotMatch(rollback, /run_live_counter_revision_advanced/i);
  assert.doesNotMatch(rollback, /drop column[\s\S]*live_counter_revision/i);
  assert.match(rollback, /grant execute on function[\s\S]*to service_role/i);
});
