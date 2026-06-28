import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_PROCESS_FORBIDDEN_LABELS,
  clientSafeProcessErrorMessage,
  projectAddAccountProcess,
  projectConnectProcess,
  projectReadinessProcess,
} from "./client-account-process-projection.ts";

function assertNoForbiddenTerms(text) {
  const normalized = text.toLowerCase();
  for (const term of CLIENT_PROCESS_FORBIDDEN_LABELS) {
    assert.equal(normalized.includes(term), false, `forbidden term "${term}" in "${text}"`);
  }
}

function assertProjectionSafe(projection) {
  const blob = [
    projection.title,
    projection.subtitle,
    projection.statusChip,
    projection.finalMessage || "",
    ...projection.steps.map((step) => `${step.label} ${step.subtitle || ""}`),
  ].join(" ");
  assertNoForbiddenTerms(blob);
}

test("add account success projection uses honest steps", () => {
  const projection = projectAddAccountProcess({
    lang: "fr",
    phase: "complete",
    account: {
      accountId: "acct-1",
      username: "demo",
      loginStatus: "unknown",
      onboardingStatus: "pending",
      provisioningStatus: "not_started",
      assignmentStatus: "pending_assignment",
      connected: false,
    },
  });
  assert.equal(projection.outcome, "success");
  assert.equal(projection.steps[0].status, "done");
  assert.equal(projection.steps[1].status, "done");
  assert.match(projection.finalMessage || "", /ajouté/i);
  assertProjectionSafe(projection);
});

test("add account error maps subscription inactive client-safe", () => {
  const message = clientSafeProcessErrorMessage("fr", "subscription_inactive", "Your subscription is not active.");
  assert.match(message, /abonnement/i);
  assertNoForbiddenTerms(message);
});

test("add account duplicate username error", () => {
  const message = clientSafeProcessErrorMessage("fr", "username_already_linked", "duplicate");
  assert.match(message, /déjà lié/i);
});

test("add account workspace failure keeps username validation done", () => {
  const projection = projectAddAccountProcess({
    lang: "fr",
    phase: "error",
    errorCode: "account_create_failed",
    errorMessage: "Impossible d'ajouter le compte pour le moment.",
  });
  assert.equal(projection.steps[0].status, "done");
  assert.equal(projection.steps[1].status, "failed");
  assertProjectionSafe(projection);
});

test("add account username validation failure marks validation step failed", () => {
  const projection = projectAddAccountProcess({
    lang: "fr",
    phase: "error",
    errorCode: "username_not_found",
    errorMessage: "Ce compte Instagram est introuvable.",
  });
  assert.equal(projection.steps[0].status, "failed");
  assert.equal(projection.steps[1].status, "pending");
  assertProjectionSafe(projection);
});

test("connect queued projection stays async", () => {
  const projection = projectConnectProcess({
    lang: "fr",
    phase: "polling",
    account: {
      loginStatus: "connecting",
      onboardingStatus: "pending",
      provisioningStatus: "in_progress",
      assignmentStatus: "pending_assignment",
      connected: false,
      operationPending: true,
    },
  });
  assert.equal(projection.outcome, "running");
  assert.equal(projection.isAsyncPending, true);
  assert.match(projection.steps[1].label, /session/i);
  assertProjectionSafe(projection);
});

test("connect ready projection completes with verified preparation", () => {
  const projection = projectConnectProcess({
    lang: "fr",
    phase: "complete",
    account: {
      loginStatus: "connected",
      onboardingStatus: "ready",
      provisioningStatus: "ready",
      assignmentStatus: "assigned",
      connected: true,
    },
  });
  assert.equal(projection.outcome, "success");
  assert.match(projection.finalMessage || "", /préparation vérifiée|connecté/i);
  assertProjectionSafe(projection);
});

test("connect action required projection", () => {
  const projection = projectConnectProcess({
    lang: "fr",
    phase: "polling",
    account: {
      loginStatus: "needs_2fa",
      onboardingStatus: "pending",
      provisioningStatus: "ready",
      assignmentStatus: "assigned",
      connected: false,
    },
  });
  assert.equal(projection.outcome, "action_required");
  assert.match(projection.statusChip, /Action requise/i);
  assertProjectionSafe(projection);
});

test("connect long running keeps refresh visible", () => {
  const projection = projectConnectProcess({
    lang: "fr",
    phase: "long_running",
    timedOut: true,
    account: {
      loginStatus: "connecting",
      onboardingStatus: "pending",
      provisioningStatus: "in_progress",
      assignmentStatus: "pending_assignment",
      connected: false,
      operationPending: true,
    },
  });
  assert.equal(projection.outcome, "long_running");
  assert.equal(projection.showRefresh, true);
  assertProjectionSafe(projection);
});

test("readiness projection uses preparation wording", () => {
  const projection = projectReadinessProcess({
    lang: "fr",
    phase: "complete",
    account: {
      loginStatus: "unknown",
      onboardingStatus: "pending",
      provisioningStatus: "not_started",
      assignmentStatus: "assigned",
      connected: false,
      clientReadinessStatus: "ready_to_connect",
    },
  });
  assert.match(projection.title, /préparation/i);
  assert.deepEqual(
    projection.steps.map((step) => step.label),
    ["Compte ajouté", "Configuration vérifiée", "Préparation vérifiée"],
  );
  assert.equal(projection.steps[2].status, "done");
  assertProjectionSafe(projection);
});

test("readiness projection pending preparation keeps third step running", () => {
  const projection = projectReadinessProcess({
    lang: "fr",
    phase: "complete",
    account: {
      loginStatus: "unknown",
      onboardingStatus: "pending",
      provisioningStatus: "not_started",
      assignmentStatus: "pending_assignment",
      connected: false,
      clientReadinessStatus: "preparation_pending",
    },
  });
  assert.equal(projection.steps[2].status, "running");
  assert.equal(projection.showRefresh, true);
  assertProjectionSafe(projection);
});
