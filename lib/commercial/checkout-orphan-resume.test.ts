import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePublicCheckoutConflict } from "./checkout-context.ts";

test("orphan unsafe: existing complete tenant blocks public checkout without mutation path", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "public_new_workspace",
    session: null,
    purchaserEmail: "existing@example.com",
    purchaserAuthUserHasTenant: true,
    purchaserHasIncompleteResumableCheckout: false,
  });
  assert.equal(result.ok, false);
});

test("incomplete resumable checkout bypasses tenant conflict guard", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "public_new_workspace",
    session: null,
    purchaserEmail: "resume@example.com",
    purchaserAuthUserHasTenant: true,
    purchaserHasIncompleteResumableCheckout: true,
  });
  assert.equal(result.ok, true);
});

test("orphan unsafe: active browser session blocks public checkout", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "public_new_workspace",
    session: {
      userId: "user-1",
      clientId: "client-liam",
      sessionEmail: "liam@example.com",
    },
    purchaserEmail: "test@example.com",
    purchaserAuthUserHasTenant: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "session_workspace_conflict");
  }
});

test("add-account checkout does not apply public orphan conflict rules", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "existing_workspace_add_account",
    session: {
      userId: "user-1",
      clientId: "client-1",
      sessionEmail: "other@example.com",
    },
    purchaserEmail: "checkout@example.com",
    purchaserAuthUserHasTenant: true,
  });
  assert.equal(result.ok, true);
});
