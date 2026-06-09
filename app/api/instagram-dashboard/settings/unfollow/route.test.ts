import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("unfollow settings reject unproven caps and session above day cap", () => {
  assert.match(routeSource, /input\.unfollowEnabled && input\.unfollowPerSessionLimit < 1[\s\S]*"unfollow_cap_unproven"/);
  assert.match(routeSource, /input\.unfollowEnabled && input\.unfollowPerDayLimit < 1[\s\S]*"unfollow_cap_unproven"/);
  assert.match(routeSource, /input\.unfollowEnabled && input\.unfollowPerSessionLimit > input\.unfollowPerDayLimit[\s\S]*"session_cap_exceeds_day_cap"/);
});

test("unfollow settings accept coherent Pro caps in prod normal mode", () => {
  assert.match(routeSource, /runtimeCapMode: normalizeUnfollowRuntimeCapMode/);
  assert.match(routeSource, /runtimeCapMode\) === "prod_normal"[\s\S]*\? null/);
  assert.doesNotMatch(routeSource, /120[\s\S]{0,80}session_cap_exceeds_day_cap/);
});

test("unfollow settings response stays no-leak", () => {
  assert.doesNotMatch(routeSource, /password|secret_ref|vault|service_role|adb_serial|raw_xml|screenshot_path/i);
});
