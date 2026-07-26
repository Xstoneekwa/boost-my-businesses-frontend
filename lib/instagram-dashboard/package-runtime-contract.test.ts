import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPackageRuntimeContract,
  reconcilePackageRuntimeContract,
} from "./package-runtime-contract.ts";

test("contract status preserves stable backend block reasons", async () => {
  const contract = await loadPackageRuntimeContract({
    rpc: async () => ({ data: { ok: false, reason: "clone_package_mismatch" }, error: null }),
  }, "account-1");
  assert.equal(contract.ok, false);
  assert.equal(contract.reason, "clone_package_mismatch");
});

test("contract status fails closed when the RPC is missing", async () => {
  const contract = await loadPackageRuntimeContract({
    rpc: async () => ({ data: null, error: { message: "function unavailable" } }),
  }, "account-1");
  assert.equal(contract.ok, false);
  assert.equal(contract.reason, "package_settings_incomplete");
});

test("canonical reconciliation extracts a stable reason from Postgres errors", async () => {
  const contract = await reconcilePackageRuntimeContract({
    rpc: async () => ({ data: null, error: { message: "P0001: app_instance_package_mismatch" } }),
  }, "account-1", "test");
  assert.equal(contract.ok, false);
  assert.equal(contract.reason, "app_instance_package_mismatch");
});
