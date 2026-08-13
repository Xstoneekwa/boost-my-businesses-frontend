import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isCanonicalVisibleProfile,
  selectCanonicalVisibleProfiles,
} from "../app/api/instagram-dashboard/profiles/live/profile-visibility.ts";

const manageSource = readFileSync(new URL("../app/instagram-dashboard/manage-data.ts", import.meta.url), "utf8");
const profilesSource = readFileSync(new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");
const liveSource = readFileSync(new URL("../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url), "utf8");

test("legacy Profiles keeps the all-account lifecycle ledger", () => {
  assert.match(profilesSource, /enrichAccountsWithRuntime\(manage\.allAccounts/);
});

test("legacy lifecycle projection still owns the generic terminal states", () => {
  for (const status of ["cancelled", "canceled", "deleted", "inactive", "deactivated", "rolled_back_test_onboarding", "onboarding_rollback"]) {
    assert.match(manageSource, new RegExp(`"${status}"`));
  }
  assert.match(manageSource, /inactiveStatuses\.has\(accountStatus\) \|\| inactiveStatuses\.has\(adminStatus\)/);
});

test("live endpoint selects the all-account projection instead of activeAccounts", () => {
  assert.match(liveSource, /selectCanonicalVisibleProfiles\(legacyPayload\.profiles\)/);
  assert.doesNotMatch(liveSource, /legacyPayload\.activeAccounts/);
  assert.match(liveSource, /profiles_live_all_accounts_visible_v2/);
});

test("ten allAccounts with two terminal rows return exactly eight visible profiles", () => {
  const allAccounts = [
    { accountId: "connected", accountLifecycleStatus: "active", loginStatus: "connected", readinessStatus: "growth_ready" },
    { accountId: "login-pending", accountLifecycleStatus: "active", loginStatus: "pending", provisioningStatus: "login_pending", connected: false },
    { accountId: "pending", accountLifecycleStatus: "pending", loginStatus: "pending" },
    { accountId: "ready", accountLifecycleStatus: "ready_to_connect" },
    { accountId: "identity-review", accountLifecycleStatus: "active", loginIdentityProofStatus: "required_unverified" },
    { accountId: "growth-ready", accountLifecycleStatus: "growth_ready" },
    { accountId: "connected-two", accountLifecycleStatus: "connected" },
    { accountId: "active-two", accountLifecycleStatus: "active" },
    { accountId: "rolled-back", accountLifecycleStatus: "rolled_back_test_onboarding" },
    { accountId: "cancelled", adminStatus: "cancelled", tombstonedAt: "2026-08-13T00:00:00.000Z" },
  ];

  const visible = selectCanonicalVisibleProfiles(allAccounts);
  assert.equal(visible.length, 8);
  assert.ok(visible.some((row) => row.accountId === "login-pending"));
  assert.ok(visible.some((row) => row.accountId === "connected"));
  assert.ok(!visible.some((row) => row.accountId === "rolled-back"));
  assert.ok(!visible.some((row) => row.accountId === "cancelled"));
});

test("visibility is independent from login, identity, readiness, and runtime state", () => {
  for (const row of [
    { accountLifecycleStatus: "active", loginStatus: "connected" },
    { accountLifecycleStatus: "active", loginStatus: "pending", provisioningStatus: "login_pending", connected: false },
    { accountLifecycleStatus: "pending", loginIdentityProofStatus: "required_unverified" },
    { accountLifecycleStatus: "ready_to_connect", readinessStatus: "growth_ready" },
  ]) {
    assert.equal(isCanonicalVisibleProfile(row), true);
  }
});

test("terminal lifecycle values and terminal timestamps are excluded generically", () => {
  for (const status of ["rolled_back_test_onboarding", "cancelled", "canceled", "deleted", "tombstoned", "archived", "trashed"]) {
    assert.equal(isCanonicalVisibleProfile({ accountLifecycleStatus: status }), false);
    assert.equal(isCanonicalVisibleProfile({ adminStatus: status }), false);
  }
  for (const field of ["archivedAt", "deletedAt", "tombstonedAt", "trashedAt"]) {
    assert.equal(isCanonicalVisibleProfile({ accountLifecycleStatus: "active", [field]: "2026-08-13T00:00:00.000Z" }), false);
  }
});

test("canonical login and readiness fields survive selection unchanged", () => {
  const pending = {
    accountId: "pending-fixture",
    accountLifecycleStatus: "active",
    loginStatus: "pending",
    provisioningStatus: "login_pending",
    loginIdentityProofStatus: "required_unverified",
    readinessProjection: { ready: false, reason: "login_pending" },
    connected: false,
  };
  const [selected] = selectCanonicalVisibleProfiles([pending]);
  assert.strictEqual(selected, pending);
  assert.equal(selected.loginStatus, "pending");
  assert.equal(selected.provisioningStatus, "login_pending");
  assert.deepEqual(selected.readinessProjection, pending.readinessProjection);
});

test("live endpoint remains read-only and reports excluded ids", () => {
  assert.doesNotMatch(liveSource, /\.(?:insert|update|upsert|delete|rpc)\(/);
  assert.match(liveSource, /archived_account_ids: \[\]/);
  assert.match(liveSource, /removed_account_ids: \[\]/);
});
