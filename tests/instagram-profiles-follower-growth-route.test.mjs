import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url),
  "utf8",
);

test("full Profiles route uses the canonical rolling 72h projection in one batch", () => {
  assert.match(source, /projectFollowerDelta72h/);
  assert.match(source, /from\("ig_account_follower_snapshots"\)/);
  assert.match(source, /\.in\("account_id", ids\)/);
  assert.match(source, /followerSnapshotsByAccount/);
  assert.doesNotMatch(source, /pending_account_follower_snapshots|no_snapshot_table/);
  assert.equal((source.match(/from\("ig_account_follower_snapshots"\)/g) ?? []).length, 1);
});
