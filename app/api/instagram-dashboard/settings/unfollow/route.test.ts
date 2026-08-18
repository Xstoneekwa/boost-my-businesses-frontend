import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const helperSource = readFileSync(new URL("./helpers.ts", import.meta.url), "utf8");

test("unfollow settings reject unproven caps and session above day cap", () => {
  assert.match(helperSource, /input\.unfollowEnabled && input\.unfollowPerSessionLimit < 1[\s\S]*"unfollow_cap_unproven"/);
  assert.match(helperSource, /input\.unfollowEnabled && input\.unfollowPerDayLimit < 1[\s\S]*"unfollow_cap_unproven"/);
  assert.match(helperSource, /input\.unfollowEnabled && input\.unfollowPerSessionLimit > input\.unfollowPerDayLimit[\s\S]*"session_cap_exceeds_day_cap"/);
});

test("unfollow settings accept coherent Pro caps in prod normal mode", () => {
  assert.match(routeSource, /runtimeCapMode: normalizeUnfollowRuntimeCapMode/);
  assert.match(routeSource, /runtimeCapMode\) === "prod_normal"[\s\S]*\? null/);
  assert.doesNotMatch(routeSource, /120[\s\S]{0,80}session_cap_exceeds_day_cap/);
});

test("unfollow settings response stays no-leak", () => {
  assert.doesNotMatch(routeSource, /password|secret_ref|vault|service_role|adb_serial|raw_xml|screenshot_path/i);
});

test("unfollow enablement changes persist explicit provenance through the canonical RPC", () => {
  assert.match(routeSource, /fieldsChanged\.includes\("unfollow_enabled"\)[\s\S]*set_account_unfollow_enablement_override_v1/);
  assert.match(routeSource, /p_override_enabled: after\.unfollowEnabled/);
  assert.match(routeSource, /p_source: "admin"/);
  assert.match(routeSource, /p_source_surface: "instagram_dashboard_settings"/);
});

test("generic settings upsert cannot override package-gated enablement materialization", () => {
  assert.match(
    routeSource,
    /fieldsChanged\.includes\("unfollow_enabled"\) \? \{\} : \{ unfollow_enabled: after\.unfollowEnabled \}/,
  );
});
