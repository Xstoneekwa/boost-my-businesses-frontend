import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const overviewSource = readFileSync(
  new URL("../../../../../../lib/instagram-dashboard/run-eligibility-overview.ts", import.meta.url),
  "utf8",
);

test("eligibility overview route is read-only and admin gated", () => {
  assert.match(routeSource, /requireInstagramAdmin\(\)/);
  assert.match(routeSource, /buildRunEligibilityOverview/);
  assert.doesNotMatch(routeSource, /create_account_run_request|runs\/start|runner\.py/i);
});

test("eligibility overview returns safe account projection fields only", () => {
  assert.match(overviewSource, /account_id/);
  assert.match(overviewSource, /username/);
  assert.match(overviewSource, /readiness_status/);
  assert.match(overviewSource, /eligibility_status/);
  assert.match(overviewSource, /play_enabled/);
  assert.match(overviewSource, /reason/);
  assert.match(overviewSource, /primary_block_reason/);
  assert.match(overviewSource, /reason_label/);
  assert.match(overviewSource, /reason_description/);
  assert.match(overviewSource, /message/);
  assert.doesNotMatch(overviewSource, /device_id|app_instance_id|assignment_id|adb_serial|secret_ref|service_role/i);
});

test("eligibility overview reason comes from run eligibility not readiness placeholder", () => {
  assert.match(overviewSource, /reason: eligibility\.ok \? "ready" : eligibility\.reason/);
  assert.match(overviewSource, /primary_block_reason: eligibility\.ok \? null : eligibility\.reason/);
  assert.match(overviewSource, /reason_description:[\s\S]*runStartBlockDescription\(eligibility\.reason\)/);
  assert.doesNotMatch(overviewSource, /reason:\s*account\.readinessProjection\?\.overall_readiness_reason/);
  assert.doesNotMatch(overviewSource, /pending_backend_wiring:\s*account\.readinessProjection/);
});
