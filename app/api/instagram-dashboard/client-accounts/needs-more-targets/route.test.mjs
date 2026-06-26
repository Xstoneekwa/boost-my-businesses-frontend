import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../../../../../lib/instagram-dashboard/needs-more-target-accounts.ts", import.meta.url), "utf8");

test("needs more targets route accepts relay auth and exposes projection fields", () => {
  assert.match(routeSource, /verifyCompassRelayKey/);
  assert.match(routeSource, /markNeedsMoreTargetAccountsManual/);
  assert.match(routeSource, /clearNeedsMoreTargetAccountsManual/);
  assert.match(routeSource, /needsMoreTargets: result\.needs_more_targets/);
  assert.match(routeSource, /eligibleTargetCount: result\.eligible_target_count/);
  assert.doesNotMatch(routeSource, /start_run:\s*true/);
});

test("needs more targets service uses dashboard action rpc with non-blocking metadata", () => {
  assert.match(serviceSource, /needs_more_target_accounts/);
  assert.match(serviceSource, /p_blocking_campaign:\s*false/);
  assert.match(serviceSource, /eligible_target_count/);
  assert.match(serviceSource, /trigger_source/);
  assert.doesNotMatch(serviceSource, /needs_assistance/);
  assert.doesNotMatch(serviceSource, /admin_lifecycle_status/);
});
