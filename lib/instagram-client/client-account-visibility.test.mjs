import assert from "node:assert/strict";
import test from "node:test";
import {
  filterClientSelectableInstagramAccounts,
  isClientSelectableInstagramAccount,
} from "./client-account-visibility.ts";

test("LOGIN_PENDING_LEGITIMATE_IS_PRESENT", () => {
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "active", status: "inactive" }), true);
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "paused", status: "active" }), true);
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "pending", status: "login_pending" }), true);
  assert.equal(isClientSelectableInstagramAccount({ status: "login_pending" }), true);
});

test("TOMBSTONE_IS_ABSENT_FROM_INSTAGRAM_ACCOUNT_LIST", () => {
  for (const status of [
    "archived",
    "trashed",
    "tombstoned",
    "cancelled",
    "canceled",
    "deleted",
    "rolled_back_test_onboarding",
    "onboarding_rollback",
  ]) {
    assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: status, status: "active" }), false);
  }
});

test("admin lifecycle is canonical when legacy status is inactive", () => {
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "active", status: "inactive" }), true);
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "cancelled", status: "inactive" }), false);
});

test("visibility is lifecycle-based and never username-based", () => {
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "active", status: "active" }), true);
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "rolled_back_test_onboarding", status: "active" }), false);
});

test("RELOAD_PRESERVES_THE_SAME_INSTAGRAM_ACCOUNT_LIST", () => {
  const rows = [
    { id: "account-active", username: "legitimate_one", admin_lifecycle_status: "active", status: "active" },
    { id: "account-pending", username: "legitimate_two", admin_lifecycle_status: "pending", status: "login_pending" },
    { id: "account-rollback", username: "arbitrary_history_name", admin_lifecycle_status: "rolled_back_test_onboarding", status: "inactive" },
    { id: "account-tombstone", username: "another_history_name", admin_lifecycle_status: "tombstoned", status: "inactive" },
  ];

  const initialProjection = filterClientSelectableInstagramAccounts(rows);
  const reloadProjection = filterClientSelectableInstagramAccounts(structuredClone(rows));

  assert.deepEqual(initialProjection.map((row) => row.id), ["account-active", "account-pending"]);
  assert.deepEqual(reloadProjection, initialProjection);
});
