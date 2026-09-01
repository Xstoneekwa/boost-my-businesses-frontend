import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isCanonicalVisibleProfile,
  selectCanonicalVisibleProfiles,
  unwrapJsonOkData,
} from "../app/api/instagram-dashboard/profiles/live/profile-visibility.ts";
import {
  classifyOperationalProfileLifecycle,
  operationalTerminalStatuses,
} from "../lib/instagram-dashboard/profile-operational-visibility.ts";

const manageSource = readFileSync(new URL("../app/instagram-dashboard/manage-data.ts", import.meta.url), "utf8");
const profilesSource = readFileSync(new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");
const liveSource = readFileSync(new URL("../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url), "utf8");

test("legacy Profiles keeps the all-account lifecycle ledger", () => {
  assert.match(profilesSource, /enrichAccountsWithRuntime\(manage\.allAccounts/);
});

test("manage activeAccounts and live selection share the operational lifecycle contract", () => {
  assert.match(manageSource, /classifyOperationalProfileLifecycle\(account\)/);
  assert.match(liveSource, /selectCanonicalVisibleProfiles\(manage\.activeAccounts\)/);
});

test("live endpoint selects the canonical activeAccounts projection", () => {
  assert.match(liveSource, /getManageData\(\{ requireCanonicalComplete: true \}\)/);
  assert.match(liveSource, /selectCanonicalVisibleProfiles\(manage\.activeAccounts\)/);
  assert.doesNotMatch(liveSource, /getLegacyProfiles|legacyPayload/);
  assert.match(liveSource, /profiles_live_shared_core_v3/);
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

  const envelope = { ok: true, data: { profiles: allAccounts } };
  const visible = selectCanonicalVisibleProfiles(unwrapJsonOkData(envelope).profiles);
  assert.equal(visible.length, 8);
  assert.ok(visible.some((row) => row.accountId === "login-pending"));
  assert.ok(visible.some((row) => row.accountId === "connected"));
  assert.ok(!visible.some((row) => row.accountId === "rolled-back"));
  assert.ok(!visible.some((row) => row.accountId === "cancelled"));
});

test("visibility is independent from login, identity, readiness, and runtime state", () => {
  for (const row of [
    { accountLifecycleStatus: "active", loginStatus: "connected" },
    { accountLifecycleStatus: "active", adminStatus: "active", status: "inactive" },
    { accountLifecycleStatus: "active", adminStatus: "inactive", loginStatus: "pending" },
    { accountLifecycleStatus: "inactive", adminStatus: "active", loginStatus: "pending", provisioningStatus: "login_pending" },
    { accountLifecycleStatus: "active", loginStatus: "pending", provisioningStatus: "login_pending", connected: false },
    { accountLifecycleStatus: "pending", loginIdentityProofStatus: "required_unverified" },
    { accountLifecycleStatus: "ready_to_connect", readinessStatus: "growth_ready" },
  ]) {
    assert.equal(isCanonicalVisibleProfile(row), true);
  }
});

test("pre-login raw inactive is visible only with an explicit nonterminal lifecycle", () => {
  const automAtism = {
    accountId: "autom-atism",
    accountLifecycleStatus: "inactive",
    adminStatus: "active",
    onboardingStatus: "configured",
    provisioningStatus: "login_pending",
    loginStatus: "pending",
    packageLabel: "Premium",
    customerStatus: "active",
    subscriptionStatus: "active",
    assignmentStatus: "reserved",
    credentialsStatus: "active",
    connected: false,
  };
  assert.equal(classifyOperationalProfileLifecycle(automAtism), "active");
  assert.equal(isCanonicalVisibleProfile(automAtism), true);
  assert.equal(isCanonicalVisibleProfile({ accountLifecycleStatus: "inactive" }), false);
  assert.equal(isCanonicalVisibleProfile({ status: "inactive" }), false);
});

test("phone busy and remediation states remain visible without changing runtime eligibility", () => {
  for (const row of [
    { adminStatus: "active", accountLifecycleStatus: "inactive", readinessReason: "skipped_phone_busy", runtimeEligible: false },
    { adminStatus: "active", accountLifecycleStatus: "inactive", loginStatus: "ready_to_connect", runtimeEligible: false },
    { adminStatus: "active", accountLifecycleStatus: "inactive", loginStatus: "instagram_credentials_rejected", runtimeEligible: false },
    { adminStatus: "active", accountLifecycleStatus: "inactive", credentialsStatus: "credentials_reauth_required", runtimeEligible: false },
    { adminStatus: "active", accountLifecycleStatus: "inactive", loginStatus: "human_confirmation_required", runtimeEligible: false },
  ]) {
    assert.equal(isCanonicalVisibleProfile(row), true);
    assert.equal(row.runtimeEligible, false);
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

test("terminal predicate remains exact and does not classify raw inactive as terminal", () => {
  assert.deepEqual(
    [...operationalTerminalStatuses].sort(),
    ["cancelled", "canceled", "deleted", "onboarding_rollback", "released-terminal", "released_terminal", "rolled_back", "rolled_back_test_onboarding", "tombstone", "tombstoned"].sort(),
  );
  assert.ok(!operationalTerminalStatuses.includes("inactive"));
  assert.ok(!operationalTerminalStatuses.includes("deactivated"));
});

test("commercial and released-terminal states remain excluded even when admin is active", () => {
  for (const row of [
    { adminStatus: "active", accountLifecycleStatus: "inactive", capacityStatus: "released_terminal" },
    { adminStatus: "active", accountLifecycleStatus: "inactive", assignmentStatus: "released-terminal" },
    { adminStatus: "active", accountLifecycleStatus: "inactive", customerStatus: "cancelled" },
    { adminStatus: "active", accountLifecycleStatus: "inactive", subscriptionStatus: "canceled" },
  ]) {
    assert.equal(isCanonicalVisibleProfile(row), false);
  }
});

test("connected transition stays continuously visible", () => {
  const before = { accountLifecycleStatus: "inactive", adminStatus: "active", loginStatus: "pending" };
  const after = { accountLifecycleStatus: "active", adminStatus: "active", loginStatus: "connected" };
  assert.equal(isCanonicalVisibleProfile(before), true);
  assert.equal(isCanonicalVisibleProfile(after), true);
});

test("live active account retains the Golden counter projection unchanged", () => {
  const liveActive = {
    accountId: "live-active",
    accountLifecycleStatus: "active",
    adminStatus: "active",
    followCount: 42,
    unfollowCount: 17,
    likeCount: 9,
    commentCount: 3,
    dmCount: 2,
  };
  const [selected] = selectCanonicalVisibleProfiles([liveActive]);
  assert.strictEqual(selected, liveActive);
  assert.deepEqual(
    [selected.followCount, selected.unfollowCount, selected.likeCount, selected.commentCount, selected.dmCount],
    [42, 17, 9, 3, 2],
  );
});

test("full refresh and live full snapshot retain the same pre-login account", () => {
  const fullProfiles = [{
    accountId: "autom-atism",
    accountLifecycleStatus: "inactive",
    adminStatus: "active",
    onboardingStatus: "configured",
    provisioningStatus: "login_pending",
    loginStatus: "pending",
  }];
  const activeAccounts = fullProfiles.filter(isCanonicalVisibleProfile);
  const liveProfiles = selectCanonicalVisibleProfiles(activeAccounts);
  assert.deepEqual(activeAccounts.map((row) => row.accountId), ["autom-atism"]);
  assert.deepEqual(liveProfiles.map((row) => row.accountId), ["autom-atism"]);
});

test("rolled-back test account and cancelled tracker stay outside the operational list", () => {
  const historical = [
    {
      accountId: "old-autom-atism",
      accountLifecycleStatus: "rolled_back_test_onboarding",
      adminStatus: "cancelled",
      active: false,
      capacityStatus: "released_terminal",
    },
    {
      accountId: "tracker",
      accountLifecycleStatus: "inactive",
      adminStatus: "cancelled",
      clientActive: true,
      capacityStatus: "released_terminal",
    },
  ];
  assert.deepEqual(selectCanonicalVisibleProfiles(historical), []);
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
