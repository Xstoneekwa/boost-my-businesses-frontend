import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AddProfileWizard.tsx", import.meta.url), "utf8");
const scheduleRouteSource = readFileSync(
  new URL("../api/instagram-dashboard/accounts/schedule-slots/route.ts", import.meta.url),
  "utf8",
);

test("Add Profile loads real devices and preserves explicit device intent", () => {
  assert.match(source, /fetch\("\/api\/instagram-dashboard\/devices"/);
  assert.match(source, /app_instances/);
  assert.match(source, /bestDefaultAppInstance/);
  assert.match(source, /client_id/);
  assert.match(source, /idempotency_key: crypto\.randomUUID\(\)/);
});

test("Admin Wizard relies on its authenticated session and never receives the BotApp relay secret", () => {
  assert.match(source, /fetch\("\/api\/instagram-dashboard\/devices", \{ headers: \{ Accept: "application\/json" \} \}\)/);
  assert.match(source, /fetch\(`\/api\/instagram-dashboard\/accounts\/schedule-slots\?/);
  assert.doesNotMatch(source, /BOTAPP_RELAY_API_KEY|x-botapp-relay-key|localStorage|sessionStorage/);
});

test("Add Profile prefers free clones and disables unsafe primary selection", () => {
  assert.match(source, /instance_type === "clone"/);
  assert.match(source, /instance_index === 1/);
  assert.match(source, /Primary requires explicit override/);
  assert.match(source, /disabled=\{Boolean\(disabledReason\)\}/);
});

test("Add Profile requires write-only credentials for canonical begin", () => {
  assert.match(source, /Password \(write-only\)/);
  assert.match(source, /form\.username\.trim\(\) && form\.password\.trim\(\)/);
  assert.match(source, /value="credentials"/);
  assert.doesNotMatch(source, /value="manual"|No credentials will be stored now/);
});

test("package and add-ons are entitlement-derived, never locally selected", () => {
  assert.match(source, /"Entitlement"/);
  assert.match(source, /client_account_entitlements/);
  assert.match(source, /cannot override package truth/);
  assert.doesNotMatch(source, /commercial_package|defaultAddProfileCommercialPackage|addProfileAddonOptions/);
});

test("schedule intent uses the business timezone helper", () => {
  assert.match(scheduleRouteSource, /normalizeBusinessTimezone/);
  assert.match(scheduleRouteSource, /generate_assignment_slot_catalog/);
  assert.match(source, /DEFAULT_BUSINESS_TIMEZONE/);
  assert.doesNotMatch(source, /scheduleSlots\?\.timezone \|\| "UTC"/);
});

test("UI states the canonical gate and zero runtime side effects", () => {
  assert.match(source, /15 eligible CTs/);
  assert.match(source, /Assignment, Auto Login, readiness and scheduler remain blocked/);
  assert.match(source, /No login, provisioning, runner, DM, Welcome, Outreach or Unfollow is launched/);
});
