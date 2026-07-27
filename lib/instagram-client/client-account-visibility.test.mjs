import assert from "node:assert/strict";
import test from "node:test";
import { isClientSelectableInstagramAccount } from "./client-account-visibility.ts";

test("active and paused account lifecycles remain selectable", () => {
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "active", status: "inactive" }), true);
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "paused", status: "active" }), true);
});

test("archived, deleted and rollback tombstones are not selectable", () => {
  for (const status of ["archived", "trashed", "cancelled", "canceled", "deleted", "rolled_back_test_onboarding"]) {
    assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: status, status: "active" }), false);
  }
});

test("admin lifecycle is canonical when legacy status is inactive", () => {
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "active", status: "inactive" }), true);
  assert.equal(isClientSelectableInstagramAccount({ adminLifecycleStatus: "cancelled", status: "inactive" }), false);
});
