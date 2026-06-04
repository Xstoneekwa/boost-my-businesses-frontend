import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const scheduleSource = readFileSync(new URL("../../../../../lib/instagram-dashboard/onboarding-schedule.ts", import.meta.url), "utf8");

test("accounts create route uses admin auth helper with local dev bypass", () => {
  assert.match(source, /requireInstagramAdmin\(\)/);
  assert.match(source, /getInstagramAdminUserContext\(\)/);
});

test("accounts create route requires credentials password only for credentials login method", () => {
  assert.match(source, /loginMethod === "credentials" && !password/);
  assert.doesNotMatch(source, /if \(!password\) return jsonError/);
});

test("accounts create route validates explicit phone app instance target", () => {
  assert.match(source, /fetchOnboardingTarget/);
  assert.match(source, /phone_app_instances/);
  assert.match(source, /app_instance_occupied/);
  assert.match(source, /app_instance_device_mismatch/);
});

test("accounts create route assigns the explicit app_instance_id and does not launch runtime", () => {
  assert.match(source, /tryAutoAssignOnboardingSchedule\(accountId, \{/);
  assert.match(source, /appInstanceId/);
  assert.match(scheduleSource, /p_clone_id: target\.appInstanceId \|\| null/);
  assert.match(scheduleSource, /p_starts_at: startsAt/);
  assert.match(scheduleSource, /p_ends_at: endsAt/);
  assert.match(scheduleSource, /p_device_id: deviceId/);
  assert.match(source, /Schedule slot is required/);
  assert.match(source, /provisioning_started: false/);
  assert.match(source, /run_started: false/);
});

test("accounts create route does not write phone_devices.id into legacy ig_accounts.device_id", () => {
  assert.match(source, /device_id: null/);
  assert.doesNotMatch(source, /device_id: isUuid\(deviceId\)/);
  assert.match(source, /tryAutoAssignOnboardingSchedule\(accountId, \{[\s\S]*deviceId/);
  assert.match(source, /device_name: deviceName/);
});

test("accounts create route keeps credentials and settings write-only", () => {
  assert.match(source, /password: ""/);
  assert.match(source, /if \(loginMethod === "credentials"\)/);
  assert.doesNotMatch(source, /loginMethod !== "credentials"[\s\S]*callSubmitAddProfileCredentials/);
});

test("accounts create route ensures ownership subscription before assignment", () => {
  assert.match(source, /ensureAddProfileOwnership/);
  assert.match(scheduleSource, /client_subscription_accounts/);
  assert.match(source, /ownership_failed:/);
  assert.match(source, /assignment_failed:/);
  assert.match(source, /loadRepairableAddProfileAccount/);
  assert.match(source, /credentials_required_for_repair/);
});

test("accounts create route accepts commercial package payload", () => {
  assert.match(source, /commercial_package/);
  assert.match(source, /readCommercialPackage/);
});
