import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url),
  "utf8",
);
const projection = readFileSync(
  new URL("../lib/instagram-dashboard/profiles-live-projection.ts", import.meta.url),
  "utf8",
);

test("live endpoint is dynamic, private no-store, and selects canonical revision", () => {
  assert.match(route, /dynamic\s*=\s*"force-dynamic"/);
  assert.match(route, /Cache-Control", "private, no-store"/);
  assert.match(route, /total_story,live_counter_revision,created_at/);
});

test("live payload is account and run scoped with canonical ack metadata", () => {
  assert.match(projection, /accountId:\s*id/);
  assert.match(projection, /runId:\s*text\(run\.id\) \|\| null/);
  assert.match(projection, /revision:\s*nonNegativeInteger\(run\.live_counter_revision\)/);
  assert.match(projection, /source:\s*"canonical_ack"/);
  assert.match(projection, /updatedAt:\s*rowTime\(run\) \|\| null/);
});
