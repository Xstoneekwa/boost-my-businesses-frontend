import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manageSource = readFileSync(new URL("../app/instagram-dashboard/manage-data.ts", import.meta.url), "utf8");
const profilesSource = readFileSync(new URL("../app/api/instagram-dashboard/profiles/route.ts", import.meta.url), "utf8");
const liveSource = readFileSync(new URL("../app/api/instagram-dashboard/profiles/live/route.ts", import.meta.url), "utf8");

test("legacy Profiles keeps the all-account lifecycle ledger", () => {
  assert.match(profilesSource, /enrichAccountsWithRuntime\(manage\.allAccounts/);
});

test("terminal lifecycle states are excluded generically", () => {
  for (const status of ["cancelled", "canceled", "deleted", "inactive", "deactivated", "rolled_back_test_onboarding", "onboarding_rollback"]) {
    assert.match(manageSource, new RegExp(`"${status}"`));
  }
  assert.match(manageSource, /inactiveStatuses\.has\(accountStatus\) \|\| inactiveStatuses\.has\(adminStatus\)/);
  assert.match(liveSource, /legacyPayload\.activeAccounts/);
});

test("live endpoint remains read-only and reports excluded ids", () => {
  assert.doesNotMatch(liveSource, /\.(?:insert|update|upsert|delete|rpc)\(/);
  assert.match(liveSource, /archived_account_ids: \[\]/);
  assert.match(liveSource, /removed_account_ids: \[\]/);
});
