import assert from "node:assert/strict";
import test from "node:test";

import { missingCanonicalClientAccountVisibilityRows } from "./canonical-client-account-visibility.ts";

const accountId = "11111111-1111-4111-8111-111111111111";

function clientAccount(overrides: Record<string, unknown> = {}) {
  return {
    accountId,
    clientId: "22222222-2222-4222-8222-222222222222",
    label: "New account",
    active: true,
    onboardingRollbackAt: null,
    loginStatus: "pending",
    provisioningStatus: "login_pending",
    onboardingStatus: "configured",
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function igAccount(overrides: Record<string, unknown> = {}) {
  return {
    accountId,
    username: "new_account",
    displayName: "New account",
    status: "inactive",
    adminLifecycleStatus: "active",
    deviceName: null,
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

test("new canonical account remains visible before login, verification and growth readiness", () => {
  const rows = missingCanonicalClientAccountVisibilityRows({
    existingAccountIds: [],
    clientAccounts: [clientAccount()],
    igAccounts: [igAccount()],
  });

  assert.deepEqual(rows, [{
    account_id: accountId,
    client_id: "22222222-2222-4222-8222-222222222222",
    client_name: "New account",
    username: "new_account",
    status: "inactive",
    admin_lifecycle_status: "active",
    login_status: "pending",
    provisioning_status: "login_pending",
    onboarding_status: "configured",
    phone_name: null,
    created_at: "2026-08-11T00:00:00.000Z",
  }]);
});

test("pending account keeps the same row when assignment metadata becomes available", () => {
  const rows = missingCanonicalClientAccountVisibilityRows({
    existingAccountIds: [],
    clientAccounts: [clientAccount()],
    igAccounts: [igAccount({ deviceName: "Samsung A16-02" })],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.account_id, accountId);
  assert.equal(rows[0]?.phone_name, "Samsung A16-02");
  assert.equal(rows[0]?.login_status, "pending");
});

test("connected transition enriches the existing row instead of creating a duplicate", () => {
  const rows = missingCanonicalClientAccountVisibilityRows({
    existingAccountIds: [accountId.toUpperCase()],
    clientAccounts: [clientAccount({ loginStatus: "connected", provisioningStatus: "ready", onboardingStatus: "ready" })],
    igAccounts: [igAccount({ status: "active" })],
  });

  assert.deepEqual(rows, []);
});

test("inactive, rolled back and tombstoned accounts are never resurrected", () => {
  const rows = missingCanonicalClientAccountVisibilityRows({
    existingAccountIds: [],
    clientAccounts: [
      clientAccount({ accountId: "inactive", active: false }),
      clientAccount({ accountId: "rolled", onboardingRollbackAt: "2026-08-11T01:00:00.000Z" }),
      clientAccount({ accountId: "tombstone" }),
    ],
    igAccounts: [
      igAccount({ accountId: "inactive" }),
      igAccount({ accountId: "rolled" }),
      igAccount({ accountId: "tombstone", username: "rb_test_tombstone", status: "rolled_back_test_onboarding" }),
    ],
  });

  assert.deepEqual(rows, []);
});
