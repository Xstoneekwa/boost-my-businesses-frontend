import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_LIFECYCLE_ACTION_MATRIX,
  LIFECYCLE_ACTION_COPY,
  LIFECYCLE_COMMUNICATION_REGISTRY,
  LIFECYCLE_STATUS_COPY,
  LIFECYCLE_STATUS_PRIORITY,
  projectCommercialLifecyclePresentation,
  resolveLifecyclePrimaryStatus,
} from "./lifecycle-communication-registry.ts";

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

test("primary status priority keeps commercial lifecycle ahead of assistance and login projections", () => {
  assert.deepEqual(LIFECYCLE_STATUS_PRIORITY.slice(0, 4), [
    "cancelled",
    "paused",
    "operator_review_required",
    "needs_assistance",
  ]);
  assert.equal(resolveLifecyclePrimaryStatus({ paused: true, needsAssistance: true, loginRequired: true }), "paused");
  assert.equal(resolveLifecyclePrimaryStatus({ cancelled: true, paused: true }), "cancelled");
  assert.equal(resolveLifecyclePrimaryStatus({ operatorReviewRequired: true, needsAssistance: true }), "operator_review_required");
  assert.equal(resolveLifecyclePrimaryStatus({ readinessStatus: "not_ready" }), "readiness");
});

test("account lifecycle action matrix is exact for active paused and cancelled states", () => {
  assert.deepEqual(ACCOUNT_LIFECYCLE_ACTION_MATRIX.active, {
    pause: true,
    cancel: true,
    mark_needs_assistance: true,
    reactivate: false,
  });
  assert.deepEqual(ACCOUNT_LIFECYCLE_ACTION_MATRIX.paused, {
    pause: false,
    cancel: true,
    mark_needs_assistance: true,
    reactivate: true,
  });
  assert.deepEqual(ACCOUNT_LIFECYCLE_ACTION_MATRIX.cancelled, {
    pause: false,
    cancel: false,
    mark_needs_assistance: false,
    reactivate: false,
  });
});

test("status and action registries provide complete French and English product copy", () => {
  for (const key of Object.keys(LIFECYCLE_COMMUNICATION_REGISTRY) as Array<keyof typeof LIFECYCLE_COMMUNICATION_REGISTRY>) {
    assert.ok(LIFECYCLE_STATUS_COPY[key].fr.trim());
    assert.ok(LIFECYCLE_STATUS_COPY[key].en.trim());
  }
  for (const locale of ["fr", "en"] as const) {
    for (const action of ["pause", "cancel", "mark_needs_assistance", "reactivate"] as const) {
      assert.ok(LIFECYCLE_ACTION_COPY[locale][action].label.trim());
      assert.ok(LIFECYCLE_ACTION_COPY[locale][action].description.trim());
      assert.ok(LIFECYCLE_ACTION_COPY[locale][action].alreadyActive.trim());
      assert.ok(LIFECYCLE_ACTION_COPY[locale][action].disabledForState.trim());
    }
  }
});

test("commercial lifecycle projection is locale complete and never fabricates non-commercial status", () => {
  assert.deepEqual(projectCommercialLifecyclePresentation("paused", "fr"), {
    status: "paused",
    label: "Compte en pause",
    tone: "warning",
  });
  assert.deepEqual(projectCommercialLifecyclePresentation("paused", "en"), {
    status: "paused",
    label: "Account paused",
    tone: "warning",
  });
  assert.deepEqual(projectCommercialLifecyclePresentation("cancelled", "fr"), {
    status: "cancelled",
    label: "Compte résilié",
    tone: "danger",
  });
  assert.equal(projectCommercialLifecyclePresentation("active", "fr"), null);
  assert.equal(projectCommercialLifecyclePresentation("paused_manual_review", "en"), null);
});
