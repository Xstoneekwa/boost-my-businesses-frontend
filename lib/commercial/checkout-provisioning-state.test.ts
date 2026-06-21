import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmptyStageMap,
  deriveResumeMode,
  isActivationChainComplete,
  PROTECTED_CHECKOUT_CLIENT_IDS,
} from "./checkout-provisioning-state.ts";

test("deriveResumeMode maps orphan vs partial resume", () => {
  const orphan = buildEmptyStageMap();
  orphan.auth = true;
  orphan.client = true;
  assert.equal(deriveResumeMode(orphan), "link_orphan_client");

  const partial = { ...orphan, tenant_users: true };
  assert.equal(deriveResumeMode(partial), "complete_partial");
});

test("activation chain complete requires audit event", () => {
  const stages = buildEmptyStageMap();
  stages.auth = true;
  stages.client = true;
  stages.tenant_users = true;
  stages.client_users = true;
  stages.subscription = true;
  stages.checkout_session = true;
  stages.entitlement = true;
  assert.equal(isActivationChainComplete(stages), false);
  stages.audit = true;
  assert.equal(isActivationChainComplete(stages), true);
});

test("Liam workspace id is protected from checkout resume", () => {
  assert.equal(PROTECTED_CHECKOUT_CLIENT_IDS.has("c37c9143-ee14-4c9a-9a60-226759241733"), true);
});

test("entitlement without audit remains resumable incomplete", () => {
  const stages = buildEmptyStageMap();
  stages.auth = true;
  stages.client = true;
  stages.tenant_users = true;
  stages.client_users = true;
  stages.subscription = true;
  stages.checkout_session = true;
  stages.entitlement = true;
  assert.equal(isActivationChainComplete(stages), false);
  assert.equal(deriveResumeMode(stages), "complete_partial");
});
