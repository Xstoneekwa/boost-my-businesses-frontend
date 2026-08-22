import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url);

test("profiles full projection includes canonical verified Unfollow evidence", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.match(source, /from\("ig_interacted_users"\)/);
  assert.match(source, /eq\("unfollow_result", "success"\)/);
  assert.match(source, /gte\("unfollowed_at", since\)/);
  assert.match(source, /mergeCanonicalInteractionEventsWithUnfollowFallback\(/);
  assert.match(source, /select\("id,account_id,run_id,event_type,event_status,interaction_type,event_at,payload"\)/);
  assert.match(source, /ig_action_logs\+ig_runs\+ig_interaction_events\+ig_interacted_users/);
});
