import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAdminReadinessProjection,
  type AdminReadinessInput,
} from "./readiness-projection.ts";

function readyInput(overrides: Partial<AdminReadinessInput> = {}): AdminReadinessInput {
  return {
    accountId: "account-1",
    username: "safe_username",
    clientId: "client-1",
    clientName: "Safe Client",
    adminStatus: "active",
    customerStatus: "active",
    subscriptionStatus: "active",
    packageName: "Growth",
    runtimeProfilesLabel: "full_cycle",
    credentialsConfigured: true,
    credentialsStatus: "active",
    reauthRequired: false,
    loginStatus: "connected",
    provisioningStatus: "ready",
    onboardingStatus: "ready",
    assignmentStatus: "active",
    assignmentStartsAt: "2026-06-09T08:00:00.000Z",
    phoneStatus: "online",
    appInstanceStatus: "occupied",
    appPackageName: "com.instagram.android.clone1",
    appInstanceLaunchable: true,
    appInstanceUsableForAutoLogin: true,
    dmSettingsPresent: true,
    welcomeSettingsPresent: true,
    unfollowSettingsPresent: true,
    dashboardActionsCount: 0,
    blockingActionsCount: 0,
    ...overrides,
  };
}

test("credentials missing returns needs_credentials", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    credentialsConfigured: false,
    credentialsStatus: "missing",
  }));

  assert.equal(projection.overall_readiness_status, "needs_credentials");
  assert.equal(projection.credential_next_action, "submit_credentials");
});

test("connected account without assignment returns needs_phone_assignment when package wiring is missing", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    packageName: "Package pending",
    runtimeProfilesLabel: "Runtime profile pending",
    assignmentStatus: null,
    phoneStatus: null,
    appInstanceStatus: null,
    appPackageName: null,
  }));

  assert.equal(projection.overall_readiness_status, "needs_phone_assignment");
  assert.equal(projection.assignment_status, "missing");
});

test("connected account without assignment waits when package and runtime profile are known", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    assignmentStatus: null,
    phoneStatus: null,
    appInstanceStatus: null,
    appPackageName: null,
  }));

  assert.equal(projection.overall_readiness_status, "waiting_scheduled_assignment");
  assert.equal(projection.assignment_status, "waiting");
});

test("connected account with assignment and settings is ready", () => {
  const projection = buildAdminReadinessProjection(readyInput());

  assert.equal(projection.overall_readiness_status, "ready");
  assert.equal(projection.overall_readiness_reason, "all_required_readiness_checks_passed");
});

test("login needs_2fa returns needs_login_verification", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    loginStatus: "needs_2fa",
  }));

  assert.equal(projection.overall_readiness_status, "needs_login_verification");
  assert.equal(projection.next_client_action, "complete_instagram_verification");
});

test("paused and cancelled override otherwise ready accounts", () => {
  assert.equal(
    buildAdminReadinessProjection(readyInput({ adminStatus: "paused" })).overall_readiness_status,
    "paused",
  );
  assert.equal(
    buildAdminReadinessProjection(readyInput({ subscriptionStatus: "cancelled" })).overall_readiness_status,
    "cancelled",
  );
});

test("pending backend wiring is visible when domain settings are missing", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    dmSettingsPresent: false,
    welcomeSettingsPresent: false,
    unfollowSettingsPresent: false,
  }));

  assert.equal(projection.overall_readiness_status, "pending_backend_wiring");
  assert.deepEqual(projection.pending_backend_wiring, [
    "dm_settings_projection",
    "unfollow_settings_projection",
    "welcome_settings_projection",
  ]);
});

test("projection output does not include sensitive fields", () => {
  const projection = buildAdminReadinessProjection(readyInput());
  const serialized = JSON.stringify(projection).toLowerCase();

  for (const forbidden of ["password", "secret", "vault", "token", "service_role", "adb", "device_id", "app_instance_id"]) {
    assert.equal(serialized.includes(forbidden), false, `leaked forbidden term: ${forbidden}`);
  }
});
