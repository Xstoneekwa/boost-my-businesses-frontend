import assert from "node:assert/strict";
import test from "node:test";

import { buildAdminReadinessProjection, type AdminReadinessInput } from "./readiness-projection.ts";

function readyInput(overrides: Partial<AdminReadinessInput> = {}): AdminReadinessInput {
  return {
    accountId: "account-1",
    username: "example_account",
    clientId: "client-1",
    clientName: "Client",
    adminStatus: "active",
    customerStatus: "active",
    subscriptionStatus: "active",
    packageName: "Growth",
    commercialAddonsLabel: "follow",
    entitlementSummary: "follow",
    runtimeProfilesLabel: "Follow60 V2",
    credentialsConfigured: true,
    credentialsStatus: "active",
    reauthRequired: false,
    loginStatus: "connected",
    provisioningStatus: "ready",
    onboardingStatus: "ready",
    loginIdentityProofStatus: "verified",
    loginIdentityProfileOpened: true,
    loginIdentityUsernameMatch: true,
    loginIdentityVerifiedAt: "2026-08-10T10:00:00.000Z",
    assignmentStatus: "active",
    assignmentStartsAt: "2026-08-10T10:00:00.000Z",
    scheduleMode: "scheduled",
    phoneStatus: "online",
    appInstanceStatus: "available",
    appPackageName: "com.instagram.android",
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

test("explicit missing or failed identity proof prevents canonical readiness", () => {
  for (const proofStatus of ["required_unverified", "failed", "proven_false_ready"]) {
    const projection = buildAdminReadinessProjection(readyInput({
      loginIdentityProofStatus: proofStatus,
      loginIdentityProfileOpened: false,
      loginIdentityUsernameMatch: false,
      loginIdentityVerifiedAt: null,
    }));
    assert.equal(projection.overall_readiness_status, "needs_login_verification");
    assert.equal(projection.overall_readiness_reason, `login_identity_${proofStatus}`);
  }
});

test("LEGACY_CONNECTED_WITH_NO_NEW_PROOF_REMAINS_NON_BLOCKING_UNTIL_REVALIDATED", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    loginIdentityProofStatus: "historical_model_missing",
    loginIdentityProfileOpened: null,
    loginIdentityUsernameMatch: null,
    loginIdentityVerifiedAt: null,
    loginStateInvalidationReason: null,
  }));
  assert.equal(projection.overall_readiness_status, "ready");
});

test("NEW_ACCOUNT_WITH_NO_PROOF_FAILS_CLOSED", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    loginIdentityProofStatus: null,
    loginIdentityProfileOpened: null,
    loginIdentityUsernameMatch: null,
    loginIdentityVerifiedAt: null,
  }));
  assert.equal(projection.overall_readiness_status, "needs_login_verification");
});

test("historical identity with explicit invalidation requires login", () => {
  const projection = buildAdminReadinessProjection(readyInput({
    loginIdentityProofStatus: "historical_model_missing",
    loginIdentityProfileOpened: null,
    loginIdentityUsernameMatch: null,
    loginIdentityVerifiedAt: null,
    loginStateInvalidationReason: "instagram_logged_out",
  }));
  assert.equal(projection.overall_readiness_status, "needs_login_verification");
});

test("verified identity is necessary but canonical readiness gates remain authoritative", () => {
  assert.equal(buildAdminReadinessProjection(readyInput()).overall_readiness_status, "ready");
  assert.equal(
    buildAdminReadinessProjection(readyInput({ phoneStatus: "blocked" })).overall_readiness_status,
    "pending_backend_wiring",
  );
});
