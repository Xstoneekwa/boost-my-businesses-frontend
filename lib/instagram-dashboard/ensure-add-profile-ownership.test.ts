import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ensureSource = readFileSync(new URL("./ensure-add-profile-ownership.ts", import.meta.url), "utf8");
const packageSource = readFileSync(new URL("./add-profile-packages.ts", import.meta.url), "utf8");
const routeSource = readFileSync(
  new URL("../../app/api/instagram-dashboard/accounts/create/route.ts", import.meta.url),
  "utf8",
);

test("Growth Pro Premium package presets are production selectable", () => {
  assert.match(packageSource, /value: "growth"/);
  assert.match(packageSource, /value: "pro"/);
  assert.match(packageSource, /value: "premium"/);
  assert.match(packageSource, /selectable: true/);
  assert.match(packageSource, /defaultAddProfileCommercialPackage\(\)[\s\S]*"growth"/);
});

test("runtime modes map to subscription types for assignment", () => {
  assert.match(packageSource, /subscriptionTypeForRuntimeMode/);
  assert.match(packageSource, /return runtimeMode === "outreach_only" \? "outreach_only" : "full_cycle"/);
});

test("ensure ownership module creates client and subscription links before assignment", () => {
  assert.match(ensureSource, /client_instagram_accounts/);
  assert.match(ensureSource, /client_subscription_accounts/);
  assert.match(ensureSource, /account_commercial_packages/);
  assert.match(ensureSource, /commercial_packages/);
  assert.match(ensureSource, /account_commercial_addons/);
  assert.match(ensureSource, /ensureCommercialPackagePreset/);
});

test("accounts create route ensures ownership before assign_account_slot", () => {
  assert.match(routeSource, /ensureAddProfileOwnership/);
  assert.match(routeSource, /tryAutoAssignOnboardingSchedule\(accountId/);
  assert.match(routeSource, /device_id: null/);
  assert.match(routeSource, /loadRepairableAddProfileAccount/);
  assert.match(routeSource, /partial:/);
});
