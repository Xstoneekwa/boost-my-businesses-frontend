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

test("manual_only assignment is ready without scheduled window", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    scheduleMode: "manual_only",
    assignmentStartsAt: null,
    assignmentStatus: "reserved",
  }));

  assert.equal(projection.assignment_status, "ready");
  assert.equal(projection.assignment_reason, "manual_only_assignment_resolved");
  assert.equal(projection.next_scheduled_session_at, null);
  assert.equal(projection.overall_readiness_status, "ready");
});

test("connected account with assignment and settings is ready", () => {
  const projection = buildAdminReadinessProjection(readyInput());

  assert.equal(projection.overall_readiness_status, "ready");
  assert.equal(projection.overall_readiness_reason, "all_required_readiness_checks_passed");
});

test("connected account without unfollow add-on does not block on missing unfollow settings", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    commercialAddonsLabel: "No add-ons",
    entitlementSummary: "follow, welcome",
    unfollowSettingsPresent: false,
  }));

  assert.equal(projection.overall_readiness_status, "ready");
  assert.equal(projection.overall_readiness_reason, "all_required_readiness_checks_passed");
  assert.equal(projection.pending_backend_wiring.includes("unfollow_settings_projection"), false);
});

test("unfollow enabled without settings returns actionable readiness reason", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    entitlementSummary: "follow, unfollow",
    unfollowSettingsPresent: false,
  }));

  assert.equal(projection.overall_readiness_status, "pending_backend_wiring");
  assert.equal(projection.overall_readiness_reason, "missing_unfollow_settings");
  assert.deepEqual(projection.pending_backend_wiring, ["missing_unfollow_settings"]);
});

test("unfollow enabled with settings does not return pending backend wiring", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    entitlementSummary: "follow, unfollow",
    unfollowSettingsPresent: true,
  }));

  assert.equal(projection.overall_readiness_status, "ready");
  assert.equal(projection.pending_backend_wiring.includes("missing_unfollow_settings"), false);
});

test("active credentials with reauth_required return saved pending verification not needs_credentials", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    credentialsConfigured: true,
    credentialsStatus: "active",
    reauthRequired: true,
    loginStatus: "unknown",
    provisioningStatus: "not_started",
    blockingActionsCount: 0,
    dashboardActionsCount: 1,
    adminStatus: "active",
    onboardingStatus: "pending",
  }));

  assert.equal(projection.overall_readiness_status, "waiting_auto_login_check");
  assert.equal(projection.credential_status, "saved_pending_verification");
  assert.equal(projection.overall_readiness_reason, "credentials_saved_pending_login_verification");
  assert.equal(projection.next_client_action, "check_login_or_auto_login");
});

test("saved pending verification credential status is treated as saved credentials", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    credentialsConfigured: true,
    credentialsStatus: "saved_pending_verification",
    reauthRequired: true,
    loginStatus: "unknown",
    provisioningStatus: "not_started",
    blockingActionsCount: 0,
    dashboardActionsCount: 1,
    adminStatus: "active",
    onboardingStatus: "pending",
  }));

  assert.equal(projection.overall_readiness_status, "waiting_auto_login_check");
  assert.equal(projection.credential_status, "saved_pending_verification");
  assert.equal(projection.next_client_action, "check_login_or_auto_login");
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
    entitlementSummary: "follow, unfollow",
    dmSettingsPresent: false,
    welcomeSettingsPresent: false,
    unfollowSettingsPresent: false,
  }));

  assert.equal(projection.overall_readiness_status, "pending_backend_wiring");
  assert.deepEqual(projection.pending_backend_wiring, [
    "dm_settings_projection",
    "missing_unfollow_settings",
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
