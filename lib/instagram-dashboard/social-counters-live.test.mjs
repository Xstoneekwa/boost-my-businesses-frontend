import assert from "node:assert/strict";
import test from "node:test";
import {
  interactionEventCounters,
  projectVerifiedRunCounters,
  reconcileSocialCounters,
} from "./social-counters.ts";

const blank = { follows: 0, unfollows: 0, likes: 0, comments: 0, dms: 0, stories: 0, interactionsTotal: 0 };

function event(eventType, username, payload = {}, overrides = {}) {
  return {
    id: `${eventType}-${username}`,
    run_id: "run-1",
    username,
    event_type: eventType,
    event_status: "success",
    event_at: "2026-07-13T16:20:00.000Z",
    payload,
    ...overrides,
  };
}

test("attempted actions never increment verified counters", () => {
  const counters = interactionEventCounters([
    event("follow_tap_sent", "target-1"),
    event("post_like_attempted", "target-1"),
  ]);
  assert.deepEqual(counters, blank);
});

test("duplicate verified events are counted once", () => {
  const first = event("follow_verified", "target-1", { progress_key: "run-1:follow_verified:target-1" });
  const duplicate = { ...first, id: "duplicate", event_at: "2026-07-13T16:20:01.000Z" };
  assert.equal(interactionEventCounters([first, duplicate]).follows, 1);
});

test("ten distinct verified follows progress from one through ten", () => {
  const rows = [];
  for (let index = 1; index <= 10; index += 1) {
    rows.push(event("follow_verified", `target-${index}`));
    assert.equal(interactionEventCounters(rows).follows, index);
  }
});

test("live likes reconcile with final canonical values without double counting", () => {
  const duplicateLiveAndFinal = [
    event("post_like_success", "target-1", { liked_count: 1, progress_key: "run-1:post_like_success:target-1" }),
    event("post_like_success", "target-1", { liked_count: 1 }),
  ];
  const active = projectVerifiedRunCounters({
    runId: "run-1",
    canonicalDailyCount: blank,
    canonicalRunCount: blank,
    interactionEvents: duplicateLiveAndFinal,
  });
  assert.equal(active.likes, 1);
  assert.equal(active.projectionSource, "active_run_verified_events");
  const finalCanonical = reconcileSocialCounters(blank, { ...blank, follows: 10, likes: 10, interactionsTotal: 20 });
  const terminal = projectVerifiedRunCounters({
    runId: "run-1",
    canonicalDailyCount: finalCanonical,
    canonicalRunCount: finalCanonical,
    interactionEvents: duplicateLiveAndFinal,
  });
  assert.equal(terminal.follows, 10);
  assert.equal(terminal.likes, 10);
  assert.equal(terminal.projectionSource, "canonical_run");
});
