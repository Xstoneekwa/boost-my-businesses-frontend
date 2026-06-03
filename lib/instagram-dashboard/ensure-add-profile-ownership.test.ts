import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ensureSource = readFileSync(new URL("./ensure-add-profile-ownership.ts", import.meta.url), "utf8");
const packageSource = readFileSync(new URL("./add-profile-packages.ts", import.meta.url), "utf8");
const routeSource = readFileSync(
  new URL("../../app/api/instagram-dashboard/accounts/create/route.ts", import.meta.url),
  "utf8",
);

test("internal test package maps to internal_test commercial code", () => {
  assert.match(packageSource, /value: "internal_test"/);
  assert.match(packageSource, /commercialCode: "internal_test"/);
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
});

test("accounts create route ensures ownership before assign_account_slot", () => {
  assert.match(routeSource, /ensureAddProfileOwnership/);
  assert.match(routeSource, /tryAutoAssignOnboardingSchedule\(accountId/);
  assert.match(routeSource, /device_id: null/);
  assert.match(routeSource, /loadRepairableAddProfileAccount/);
  assert.match(routeSource, /partial:/);
});
