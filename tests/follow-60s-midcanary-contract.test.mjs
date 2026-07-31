import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stopRoute = readFileSync(new URL("../app/api/instagram-dashboard/stop/route.ts", import.meta.url), "utf8");
const runControl = readFileSync(new URL("../lib/instagram-dashboard/run-control.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260731131850_follow_60s_midcanary_stage_barrier_v1.sql", import.meta.url), "utf8");

test("linked stop waits for Worker exit before run terminalization", () => {
  const linkedBranch = stopRoute.slice(stopRoute.indexOf("if (linkedRunId)"), stopRoute.indexOf("} else {", stopRoute.indexOf("if (linkedRunId)")));
  assert.doesNotMatch(linkedBranch, /reconcileLinkedIgRunTerminal/);
  assert.match(linkedBranch, /waits for device-action quiescence and process exit/);
  assert.match(stopRoute, /waiting for Worker quiescence/);
  assert.match(stopRoute, /stopped:\s*runStopped/);
  assert.doesNotMatch(stopRoute, /stopped:\s*runStopped\s*\|\|\s*Boolean\(runId\)/);
  assert.match(stopRoute, /waiting_for_worker_quiescence/);
});

test("evaluation hold blocks every centralized run-start path", () => {
  assert.match(runControl, /follow_60s_evaluation_hold/);
  assert.match(runControl, /barrier_waiting_stop/);
  assert.match(runControl, /waiting_operator_evaluation/);
});

test("stage receipts are unique and service-role only", () => {
  assert.match(migration, /ig_interaction_events_stage_idempotency_uidx/);
  assert.match(migration, /persist_follow_60s_stage_v1/);
  assert.match(migration, /mark_follow_60s_canary_barrier_v1/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  for (const stage of ["mute_posts_verified", "mute_stories_verified", "like_verified", "return_ct_exact"]) {
    assert.match(migration, new RegExp(stage));
  }
});
