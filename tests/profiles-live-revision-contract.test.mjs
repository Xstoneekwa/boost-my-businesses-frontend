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
const canonicalProfilesRoute = readFileSync(
  new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url),
  "utf8",
);

test("live endpoint is dynamic, private no-store, and selects canonical revision", () => {
  assert.match(route, /dynamic\s*=\s*"force-dynamic"/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /getManageData\(\{ requireCanonicalComplete: true \}\)/);
  assert.match(route, /selectCanonicalVisibleProfiles\(manage\.activeAccounts\)/);
  assert.match(route, /enrichAccountsWithRuntime/);
  assert.doesNotMatch(route, /GET as getLegacyProfiles|legacyPayload/);
  assert.match(canonicalProfilesRoute, /total_story,live_counter_revision,created_at/);
  assert.match(canonicalProfilesRoute, /projection_revision:\s*projectionGeneratedAt/);
  assert.match(route, /projection_revision:\s*generatedAt/);
  assert.doesNotMatch(route, /generated_at:\s*new Date\(\)\.toISOString\(\)/);
});

test("live payload is account and run scoped with canonical ack metadata", () => {
  assert.match(projection, /accountId:\s*id/);
  assert.match(projection, /runId:\s*text\(run\.id\) \|\| null/);
  assert.match(projection, /revision:\s*nonNegativeInteger\(run\.live_counter_revision\)/);
  assert.match(projection, /source:\s*"canonical_ack"/);
  assert.match(projection, /updatedAt:\s*rowTime\(run\) \|\| null/);
});
