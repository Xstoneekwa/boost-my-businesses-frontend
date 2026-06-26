import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveClientAccountState } from "./client-account-state.ts";
import {
  mapProgressToClientConnectStatus,
  projectClientConnectProgress,
} from "./connect-progress-projection.ts";

const modalSource = readFileSync(
  new URL("../../app/instagram-client/ClientVerificationModal.tsx", import.meta.url),
  "utf8",
);
const sectionSource = readFileSync(
  new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
  "utf8",
);
const runControlSource = readFileSync(
  new URL("../instagram-dashboard/run-control.ts", import.meta.url),
  "utf8",
);
const cancelRouteSource = readFileSync(
  new URL("../../app/api/instagram-client/accounts/[accountId]/connect/cancel-attempt/route.ts", import.meta.url),
  "utf8",
);

test("verification modal does not promise resume on code_submitted alone", () => {
  assert.doesNotMatch(modalSource, /resumeStatus === "queued" \|\| status === "code_submitted"/);
  assert.match(modalSource, /resumeStatus === "queued"/);
});

test("code submitted without resume stays verification_code_accepted", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "account-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: true,
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "code_submitted",
    },
  });
  assert.equal(status, "verification_code_accepted");
});

test("resume active only when resume request is queued or running", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "account-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: true,
    resumeRequestStatus: "queued",
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "code_submitted",
      resume_status: "queued",
    },
  });
  assert.equal(status, "verification_resume_active");
});

test("terminal failed resume does not map to not_created", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "account-1",
    overallStatus: "failed",
    requestStatus: "failed",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: true,
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "code_submitted",
    },
  });
  assert.equal(status, "failed");
});

test("cancel restart button is contextual and uses client cancel route", () => {
  assert.match(sectionSource, /showCancelRestart/);
  assert.match(sectionSource, /connect\/cancel-attempt/);
  assert.match(sectionSource, /Annuler et recommencer/);
  assert.match(cancelRouteSource, /cancelClientConnectAttempt/);
});

test("email code resume handoff releases active login_provisioning before enqueue", () => {
  assert.match(runControlSource, /releaseActiveLoginProvisioningForEmailCodeResume/);
  assert.match(runControlSource, /email_code_resume_handoff/);
});

test("neutral account hides cancel restart CTA", () => {
  const ui = resolveClientAccountState({
    loginStatus: "unknown",
    provisioningStatus: "not_started",
    assignmentStatus: "pending_assignment",
    connected: false,
    clientReadinessStatus: null,
    activeConnectStatus: null,
  }, "fr");
  assert.equal(ui.showCancelRestart, false);
});

test("active verification exposes cancel restart CTA", () => {
  const ui = resolveClientAccountState({
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    connected: false,
    activeConnectStatus: "verification_code_accepted",
  }, "fr");
  assert.equal(ui.showCancelRestart, true);
  assert.equal(ui.cancelRestartLabel, "Annuler et recommencer");
});

test("projected progress message stays code saved without active resume", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "account-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: true,
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "code_submitted",
    },
    lang: "fr",
  });
  assert.equal(snapshot.connect_status, "verification_code_accepted");
  assert.match(snapshot.message, /Code enregistré/);
  assert.doesNotMatch(snapshot.message, /Reprise automatique|reprenons la connexion automatiquement/i);
});
