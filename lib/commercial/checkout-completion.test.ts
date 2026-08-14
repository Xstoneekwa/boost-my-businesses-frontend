import assert from "node:assert/strict";
import test from "node:test";

import { isCanonicalCheckoutTenantMembershipRole } from "./checkout-completion.ts";

test("canonical checkout completion accepts tenant and agency superadmin memberships", () => {
  assert.equal(isCanonicalCheckoutTenantMembershipRole("tenant"), true);
  assert.equal(isCanonicalCheckoutTenantMembershipRole("superadmin"), true);
});

test("canonical checkout completion rejects absent and non-canonical tenant memberships", () => {
  assert.equal(isCanonicalCheckoutTenantMembershipRole("admin"), false);
  assert.equal(isCanonicalCheckoutTenantMembershipRole("owner"), false);
  assert.equal(isCanonicalCheckoutTenantMembershipRole(""), false);
  assert.equal(isCanonicalCheckoutTenantMembershipRole(null), false);
});
