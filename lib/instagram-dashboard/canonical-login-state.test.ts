import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCanonicalVerifiedLoginIdentity,
  projectCanonicalLoginStatus,
} from "./canonical-login-state.ts";

function verified(overrides: Record<string, unknown> = {}) {
  return {
    loginStatus: "connected",
    loginIdentityProofStatus: "verified",
    loginIdentityProfileOpened: true,
    loginIdentityUsernameMatch: true,
    loginIdentityVerifiedAt: "2026-08-10T10:00:00.000Z",
    ...overrides,
  };
}

test("SUCCESSFUL_LOGIN_REMAINS_CONNECTED_AFTER_REFRESH", () => {
  const row = verified();
  assert.equal(projectCanonicalLoginStatus(row), "connected");
  assert.equal(projectCanonicalLoginStatus({ ...row }), "connected");
});

test("SOCIAL_SNAPSHOT_FAILURE_DOES_NOT_SET_LOGIN_REQUIRED", () => {
  assert.equal(projectCanonicalLoginStatus(verified({ socialStatus: "failed" })), "connected");
});

test("SOCIAL_STALE_DOES_NOT_SET_LOGIN_REQUIRED", () => {
  assert.equal(projectCanonicalLoginStatus(verified({ socialStatus: "stale" })), "connected");
});

test("SOCIAL_UNAVAILABLE_DOES_NOT_SET_LOGIN_REQUIRED", () => {
  assert.equal(projectCanonicalLoginStatus(verified({ socialStatus: "unavailable" })), "connected");
});

test("EXPLICIT_NEW_LOGIN_REQUIRED_CAN_DOWNGRADE_CONNECTED", () => {
  assert.equal(projectCanonicalLoginStatus(verified({
    loginStatus: "logged_out",
    loginIdentityProofStatus: "failed",
  })), "logged_out");
});

test("connected without exact persisted identity proof fails closed", () => {
  assert.equal(hasCanonicalVerifiedLoginIdentity(verified()), true);
  for (const row of [
    verified({ loginIdentityProfileOpened: false }),
    verified({ loginIdentityUsernameMatch: false }),
    verified({ loginIdentityVerifiedAt: null }),
  ]) {
    assert.equal(projectCanonicalLoginStatus(row), "verification_pending");
  }
});

test("HISTORICAL_HEALTHY_ACCOUNT_IS_NOT_DOWNGRADED_BY_NEW_IDENTITY_SCHEMA", () => {
  assert.equal(projectCanonicalLoginStatus(verified({
    loginIdentityProofStatus: "historical_model_missing",
    loginIdentityProfileOpened: null,
    loginIdentityUsernameMatch: null,
    loginIdentityVerifiedAt: null,
    loginStateInvalidationReason: null,
  })), "connected");
});

test("EXPLICIT_INVALIDATION_REQUIRES_LOGIN", () => {
  assert.equal(projectCanonicalLoginStatus(verified({
    loginIdentityProofStatus: "historical_model_missing",
    loginIdentityProfileOpened: null,
    loginIdentityUsernameMatch: null,
    loginIdentityVerifiedAt: null,
    loginStateInvalidationReason: "instagram_logged_out",
  })), "verification_pending");
});
