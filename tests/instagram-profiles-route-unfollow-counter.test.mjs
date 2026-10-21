import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { interactionEventCounters, mergeCanonicalInteractionEventsWithUnfollowFallback } from "../lib/instagram-dashboard/social-counters.ts";

const routeUrl = new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url);

test("profiles full projection includes canonical verified Unfollow evidence", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.match(source, /from\("ig_interacted_users"\)/);
  assert.match(source, /eq\("unfollow_result", "success"\)/);
  assert.match(source, /gte\("unfollowed_at", since\)/);
  assert.match(source, /mergeCanonicalInteractionEventsWithUnfollowFallback\(\s*\(interactionEventsResult\.data \?\? \[\]\) as RecordValue\[\],\s*\(unfollowsResult\.data \?\? \[\]\) as RecordValue\[\]/);
  assert.match(source, /ig_action_logs\+ig_runs\+ig_interaction_events\+ig_interacted_users/);
});


test("verified Unfollow fallback keeps native authority and rejects incomplete evidence", () => {
  const row = { id: "interaction-1", account_id: "account-1", run_id: "run-1", username: "fixture-recipient", unfollowed_at: "2026-10-19T00:00:00.000Z", unfollow_result: "success" };
  const native = { id: "event-1", account_id: "account-1", run_id: "run-1", event_type: "unfollow_verified", event_status: "success", payload: { interaction_row_id: row.id, target_username: row.username } };
  const fallback = mergeCanonicalInteractionEventsWithUnfollowFallback([], [row, row]);
  assert.equal(fallback.length, 1);
  assert.equal(interactionEventCounters(fallback).unfollows, 1);
  const combined = mergeCanonicalInteractionEventsWithUnfollowFallback([native], [row]);
  assert.deepEqual(combined, [native]);
  assert.equal(interactionEventCounters(combined).unfollows, 1);
  for (const patch of [{ unfollow_result: "failed" }, { unfollowed_at: "" }, { account_id: "" }, { run_id: "" }, { username: "" }]) {
    assert.equal(mergeCanonicalInteractionEventsWithUnfollowFallback([], [{ ...row, ...patch }]).length, 0);
  }
});
