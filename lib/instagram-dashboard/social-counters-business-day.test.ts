import assert from "node:assert/strict";
import test from "node:test";

import {
  interactionEventCountersByDay,
  verifiedUnfollowRowsAsInteractionEvents,
} from "./social-counters.ts";

test("verified actions cross the daily boundary at 22:00 UTC / 00:00 SAST", () => {
  const byDay = interactionEventCountersByDay([
    { id: "before", account_id: "a", run_id: "r", username: "before", event_type: "follow_verified", event_status: "success", event_at: "2026-07-27T21:59:59.999Z" },
    { id: "after", account_id: "a", run_id: "r", username: "after", event_type: "follow_verified", event_status: "success", event_at: "2026-07-27T22:00:00.000Z" },
  ]);
  assert.equal(byDay.get("2026-07-27")?.follows, 1);
  assert.equal(byDay.get("2026-07-28")?.follows, 1);
});

test("persisted Unfollow continuation attribution prefers last_run_id", () => {
  const events = verifiedUnfollowRowsAsInteractionEvents([{
    id: "u1",
    account_id: "a",
    run_id: "original-follow-run",
    last_run_id: "unfollow-continuation-run",
    username: "Target",
    unfollow_result: "success",
    unfollowed_at: "2026-07-27T22:00:00.000Z",
  }]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.run_id, "unfollow-continuation-run");
  assert.equal(events[0]?.event_at, "2026-07-27T22:00:00.000Z");
});
