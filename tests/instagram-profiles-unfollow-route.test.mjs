import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");

test("Profiles uses verified persisted unfollows and no removed schema flag", () => {
  assert.match(source, /ig_interacted_users/);
  assert.match(source, /unfollowed_at/);
  assert.match(source, /\.eq\("unfollow_result", "success"\)/);
  assert.match(source, /verifiedUnfollowRowsAsInteractionEvents/);
  assert.doesNotMatch(source, /\.eq\("unfollowed", true\)/);
});
