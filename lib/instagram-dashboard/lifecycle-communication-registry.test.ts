import assert from "node:assert/strict";
import test from "node:test";
import { LIFECYCLE_COMMUNICATION_REGISTRY } from "./lifecycle-communication-registry.ts";

test("commercial pause has an explicit email and runtime-block policy", () => {
  assert.equal(LIFECYCLE_COMMUNICATION_REGISTRY.account_paused.email.required, true);
  assert.equal(LIFECYCLE_COMMUNICATION_REGISTRY.account_paused.email.templateCategory, "account_paused");
  assert.equal(LIFECYCLE_COMMUNICATION_REGISTRY.account_paused.schedulerRuntimeEffect, "blocked");
});

test("resume resolves pause without inventing an email policy", () => {
  assert.equal(LIFECYCLE_COMMUNICATION_REGISTRY.account_resumed.email.required, false);
  assert.equal(LIFECYCLE_COMMUNICATION_REGISTRY.account_resumed.schedulerRuntimeEffect, "recompute");
});

test("operational target threshold remains distinct from onboarding readiness", () => {
  const policy = LIFECYCLE_COMMUNICATION_REGISTRY.needs_more_target_accounts;
  assert.equal(policy.email.required, true);
  assert.equal(policy.schedulerRuntimeEffect, "unchanged");
  assert.match(policy.adminWording, /seuil opérationnel/i);
});

test("security and review statuses never inherit commercial email implicitly", () => {
  for (const key of ["operator_review_required", "login_required", "identity_verification_required"] as const) {
    assert.equal(LIFECYCLE_COMMUNICATION_REGISTRY[key].email.required, false);
    assert.equal(LIFECYCLE_COMMUNICATION_REGISTRY[key].schedulerRuntimeEffect, "blocked");
  }
});
