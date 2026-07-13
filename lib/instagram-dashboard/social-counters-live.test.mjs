import assert from "node:assert/strict";
import test from "node:test";
import { projectVerifiedRunCounters } from "./social-counters.ts";

const blank = { follows: 0, unfollows: 0, likes: 0, comments: 0, dms: 0, stories: 0, interactionsTotal: 0 };
const now = "2026-07-13T16:30:00.000Z";

function event(username, overrides = {}) {
  return {
    id: `event-${username}`,
    account_id: "account-1",
    run_id: "run-1",
    username,
    event_type: "follow_verified",
    event_status: "success",
    event_at: "2026-07-13T16:20:00.000Z",
    payload: {},
    ...overrides,
  };
}

function canonical(username, overrides = {}) {
  return {
    id: `log-${username}`,
    account_id: "account-1",
    run_id: "run-1",
    target_username: username,
    action_type: "follow_completed",
    status: "success",
    payload: {},
    ...overrides,
  };
}

function project({ canonicalCount = 0, events = [], actions = [] } = {}) {
  return projectVerifiedRunCounters({
    accountId: "account-1",
    runId: "run-1",
    now,
    canonicalDailyCount: { ...blank, follows: canonicalCount, interactionsTotal: canonicalCount },
    canonicalActions: actions,
    interactionEvents: events,
  });
}

test("canonical zero plus one new verified action is one", () => {
  assert.equal(project({ events: [event("target-1")] }).follows, 1);
});

test("same canonical and live identity is absorbed action by action", () => {
  const result = project({ canonicalCount: 1, actions: [canonical("target-1")], events: [event("target-1")] });
  assert.equal(result.follows, 1);
  assert.equal(result.unabsorbedVerifiedCount.follows, 0);
});

test("canonical five plus two new actions is seven", () => {
  assert.equal(project({ canonicalCount: 5, events: [event("target-6"), event("target-7")] }).follows, 7);
});

test("one absorbed and one new action adds only one", () => {
  const result = project({
    canonicalCount: 5,
    actions: [canonical("target-5")],
    events: [event("target-5"), event("target-6")],
  });
  assert.equal(result.follows, 6);
});

test("duplicate live events do not double count", () => {
  assert.equal(project({ events: [event("target-1"), event("target-1", { id: "duplicate" })] }).follows, 1);
});

test("old run, other account and future events are ignored", () => {
  const result = project({ events: [
    event("old", { run_id: "run-old" }),
    event("other", { account_id: "account-2" }),
    event("future", { event_at: "2026-07-13T16:40:00.000Z" }),
  ] });
  assert.equal(result.follows, 0);
});

test("terminal canonical value remains stable and no-live behavior is unchanged", () => {
  assert.equal(project({ canonicalCount: 7 }).follows, 7);
  const absorbed = project({ canonicalCount: 7, actions: [canonical("target-7")], events: [event("target-7")] });
  assert.equal(absorbed.follows, 7);
});

test("multi-unit likes absorb units for the same identity", () => {
  const likeEvent = event("target-1", { event_type: "post_like_success", payload: { liked_count: 2 } });
  const likeLog = canonical("target-1", { action_type: "post_like_completed", payload: { liked_count: 1 } });
  const result = projectVerifiedRunCounters({
    accountId: "account-1",
    runId: "run-1",
    now,
    canonicalDailyCount: { ...blank, likes: 5, interactionsTotal: 5 },
    canonicalActions: [likeLog],
    interactionEvents: [likeEvent],
  });
  assert.equal(result.likes, 6);
});
