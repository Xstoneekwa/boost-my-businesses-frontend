import assert from "node:assert/strict";
import test from "node:test";
import { CtDomainError } from "./errors.ts";

test("CtDomainError defaults its message to the strict domain code", () => {
  const error = new CtDomainError("account_not_found");

  assert.equal(error.code, "account_not_found");
  assert.equal(error.message, "account_not_found");
  assert.equal(error.name, "CtDomainError");
  assert.equal(error instanceof Error, true);
});

test("CtDomainError accepts a free-form message without changing its domain code", () => {
  const error = new CtDomainError("idempotency_conflict", "proposal_version_conflict");

  assert.equal(error.code, "idempotency_conflict");
  assert.equal(error.message, "proposal_version_conflict");
  assert.equal(error instanceof Error, true);
});
