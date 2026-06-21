import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePublicCheckoutConflict,
  resolveCheckoutContext,
  resolveCheckoutHandoff,
} from "./checkout-context.ts";

test("resolveCheckoutContext maps flow types", () => {
  assert.equal(resolveCheckoutContext({ flowType: "first_purchase" }), "public_new_workspace");
  assert.equal(
    resolveCheckoutContext({ flowType: "additional_account" }),
    "existing_workspace_add_account",
  );
  assert.equal(
    resolveCheckoutContext({ flowType: "plan_change" }),
    "existing_workspace_plan_change",
  );
});

test("public checkout blocks when browser session email differs from purchaser email", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "public_new_workspace",
    session: {
      userId: "user-1",
      clientId: "client-1",
      sessionEmail: "logged-in@example.com",
    },
    purchaserEmail: "checkout@example.com",
    purchaserAuthUserHasTenant: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "session_workspace_conflict");
    assert.equal(result.redirectPath, null);
  }
});

test("public checkout blocks same-email session and points to choose-plan", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "public_new_workspace",
    session: {
      userId: "user-1",
      clientId: "client-1",
      sessionEmail: "same@example.com",
    },
    purchaserEmail: "same@example.com",
    purchaserAuthUserHasTenant: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "existing_workspace_use_choose_plan");
    assert.equal(result.redirectPath, "/instagram-client/choose-plan");
  }
});

test("public checkout without session blocks when purchaser auth user already has tenant", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "public_new_workspace",
    session: null,
    purchaserEmail: "existing@example.com",
    purchaserAuthUserHasTenant: true,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "existing_workspace_use_choose_plan");
    assert.equal(result.redirectPath, "/instagram-login");
  }
});

test("public checkout allows incomplete resumable tenant without blocking", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "public_new_workspace",
    session: null,
    purchaserEmail: "resume@example.com",
    purchaserAuthUserHasTenant: true,
    purchaserHasIncompleteResumableCheckout: true,
  });
  assert.equal(result.ok, true);
});

test("public checkout without session allows brand-new purchaser", () => {
  const result = evaluatePublicCheckoutConflict({
    checkoutContext: "public_new_workspace",
    session: null,
    purchaserEmail: "new@example.com",
    purchaserAuthUserHasTenant: false,
  });
  assert.equal(result.ok, true);
});

test("add-account checkout skips public conflict rules", () => {
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

test("public checkout success uses email login handoff", () => {
  const handoff = resolveCheckoutHandoff("public_new_workspace");
  assert.equal(handoff.type, "email_login");
  assert.equal(handoff.loginPath, "/instagram-login");
});

test("add-account checkout success returns dashboard handoff", () => {
  const handoff = resolveCheckoutHandoff("existing_workspace_add_account");
  assert.equal(handoff.type, "dashboard");
  assert.equal(handoff.redirectPath, "/instagram-client");
});

test("plan change checkout returns dashboard handoff", () => {
  const handoff = resolveCheckoutHandoff("existing_workspace_plan_change");
  assert.equal(handoff.type, "dashboard");
  assert.equal(handoff.redirectPath, "/instagram-client");
});
