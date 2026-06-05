import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AddProfileWizard.tsx", import.meta.url), "utf8");
const scheduleRouteSource = readFileSync(
  new URL("../api/instagram-dashboard/accounts/schedule-slots/route.ts", import.meta.url),
  "utf8",
);

test("Add Profile wizard loads real devices and app instances", () => {
  assert.match(source, /fetch\("\/api\/instagram-dashboard\/devices"/);
  assert.match(source, /app_instances/);
  assert.match(source, /bestDefaultAppInstance/);
  assert.equal(source.includes("dual_app_normal"), false);
  assert.equal(source.includes("Local Android Emulator"), false);
});

test("Add Profile wizard prefers free clones and disables unsafe primary selection", () => {
  assert.match(source, /instance_type === "clone"/);
  assert.match(source, /instance_index === 1/);
  assert.match(source, /Primary requires explicit override/);
  assert.match(source, /disabled=\{Boolean\(disabledReason\)\}/);
});

test("Add Profile wizard keeps password write-only and optional for manual login", () => {
  assert.match(source, /form\.login_method === "credentials"/);
  assert.match(source, /Password \(write-only\)/);
  assert.match(source, /No credentials will be stored now/);
  assert.match(source, /app_instance_id: selectedAppInstance\.app_instance_id/);
});

test("Add Profile wizard has Package and Add-ons step plus Schedule", () => {
  assert.match(source, /"Package & Add-ons"/);
  assert.match(source, /"Schedule"/);
  assert.match(source, /accounts\/schedule-slots/);
  assert.match(source, /commercial_package/);
  assert.match(source, /addProfilePackageOptions/);
  assert.match(source, /addProfileRuntimeOptions/);
  assert.match(source, /addProfileAddonOptions/);
  assert.match(source, /defaultAddProfileCommercialPackage/);
  assert.equal(source.includes("Start from scratch"), false);
  assert.equal(source.includes("Select settings template"), false);
  assert.equal(source.includes("Default settings template"), false);
});

test("Add Profile schedule slots use the business timezone helper", () => {
  assert.match(scheduleRouteSource, /normalizeBusinessTimezone/);
  assert.match(scheduleRouteSource, /generate_assignment_slot_catalog/);
  assert.doesNotMatch(scheduleRouteSource, /readString\(device\.timezone, "UTC"\)/);
  assert.match(source, /DEFAULT_BUSINESS_TIMEZONE/);
  assert.doesNotMatch(source, /scheduleSlots\?\.timezone \|\| "UTC"/);
});

test("Add Profile review states no runtime action is launched", () => {
  assert.match(source, /No login, provisioning, runner, DM, Welcome, Outreach or Unfollow is launched/);
  assert.match(source, /visible later in Schedule drawer/);
});
