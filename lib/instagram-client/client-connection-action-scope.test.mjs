import assert from "node:assert/strict";
import test from "node:test";
import { resolveClientConnectionActionPanel } from "./client-connection-action-scope.ts";

const accounts = ["account-a", "account-b", "account-c", "account-d"].map((accountId) => ({ accountId }));

test("single-account tenants keep their connection action panel", () => {
  const panel = resolveClientConnectionActionPanel({
    accounts: accounts.slice(0, 1),
    agencyModeActive: false,
    overviewScope: "",
  });
  assert.equal(panel.visible, true);
  assert.deepEqual(panel.accounts.map((row) => row.accountId), ["account-a"]);
  assert.equal(panel.accountScopeId, null);
});

test("agency overview stays aggregate while selected account gets its own action", () => {
  const aggregate = resolveClientConnectionActionPanel({
    accounts,
    agencyModeActive: true,
    overviewScope: "agency",
  });
  assert.equal(aggregate.visible, false);
  assert.equal(aggregate.accounts.length, 4);

  const selected = resolveClientConnectionActionPanel({
    accounts,
    agencyModeActive: true,
    overviewScope: "account-c",
  });
  assert.equal(selected.visible, true);
  assert.deepEqual(selected.accounts.map((row) => row.accountId), ["account-c"]);
  assert.equal(selected.accountScopeId, "account-c");
});

test("account selection never falls back to another account or tenant", () => {
  const missing = resolveClientConnectionActionPanel({
    accounts,
    agencyModeActive: true,
    overviewScope: "account-from-another-tenant",
  });
  assert.equal(missing.visible, false);
  assert.deepEqual(missing.accounts, []);
  assert.equal(missing.accountScopeId, null);
});
