import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKOUT_PASSWORD_MIN_LENGTH,
  validatePublicCheckoutPassword,
} from "./checkout-password.ts";

test("public checkout password requires minimum length", () => {
  const result = validatePublicCheckoutPassword({
    password: "short",
    passwordConfirmation: "short",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "password_too_short");
  }
});

test("public checkout password requires matching confirmation", () => {
  const result = validatePublicCheckoutPassword({
    password: "a".repeat(CHECKOUT_PASSWORD_MIN_LENGTH),
    passwordConfirmation: "b".repeat(CHECKOUT_PASSWORD_MIN_LENGTH),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "password_mismatch");
  }
});

test("public checkout password accepts valid pair", () => {
  const password = "SecurePass123!";
  const result = validatePublicCheckoutPassword({
    password,
    passwordConfirmation: password,
  });
  assert.equal(result.ok, true);
});

test("public checkout password rejects empty values", () => {
  assert.equal(
    validatePublicCheckoutPassword({ password: "", passwordConfirmation: "" }).ok,
    false,
  );
  assert.equal(
    validatePublicCheckoutPassword({
      password: "a".repeat(CHECKOUT_PASSWORD_MIN_LENGTH),
      passwordConfirmation: "",
    }).ok,
    false,
  );
});
