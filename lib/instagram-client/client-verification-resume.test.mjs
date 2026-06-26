import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mapProgressToClientConnectStatus,
  projectClientConnectProgress,
} from "./connect-progress-projection.ts";

const verificationModal = readFileSync(
  new URL("../../app/instagram-client/ClientVerificationModal.tsx", import.meta.url),
  "utf8",
);
const processModal = readFileSync(
  new URL("../../app/instagram-client/ClientAccountProcessModal.tsx", import.meta.url),
  "utf8",
);
const clientSection = readFileSync(
  new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
  "utf8",
);
const submitRoute = readFileSync(
  new URL("../../app/api/instagram-client/accounts/[accountId]/connect/submit-verification-code/route.ts", import.meta.url),
  "utf8",
);
const runControlSource = readFileSync(
  new URL("../instagram-dashboard/run-control.ts", import.meta.url),
  "utf8",
);
const submitService = readFileSync(
  new URL("../instagram-dashboard/submit-verification-code-service.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../app/instagram-client/page.tsx", import.meta.url),
  "utf8",
);

test("client verification UI exposes no BotApp phone CTA or client open-device route", () => {
  assert.doesNotMatch(verificationModal, /Ouvrir le téléphone dans BotApp|Open phone in BotApp/);
  assert.doesNotMatch(processModal, /Ouvrir le téléphone dans BotApp|Open phone in BotApp/);
  assert.doesNotMatch(clientSection, /open-botapp-phone|botapp:\/\//);
  assert.doesNotMatch(verificationModal, /onOpenBotAppPhone|openBotAppPhone/);
});

test("code submitted without resume stays verification_code_accepted", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    actionRequired: {
      action_type: "enter_email_verification_code",
      status: "code_submitted",
    },
  });
  assert.equal(status, "verification_code_accepted");
});

test("code submitted with queued resume maps to verification_resume_active", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    resumeRequestStatus: "queued",
    actionRequired: {
      action_type: "enter_email_verification_code",
      status: "code_submitted",
      resume_status: "queued",
    },
  });
  assert.equal(status, "verification_resume_active");
});

test("projected client progress never claims resume before resume request exists", () => {
  const accepted = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "code_submitted",
    },
    lang: "fr",
  });
  assert.equal(accepted.connect_status, "verification_code_accepted");
  assert.match(accepted.message, /Code enregistré/);
  assert.doesNotMatch(accepted.message, /reprenons la connexion automatiquement/);

  const active = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    resumeRequestStatus: "running",
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "code_submitted",
      resume_status: "running",
    },
    lang: "fr",
  });
  assert.equal(active.connect_status, "verification_resume_active");
  assert.match(active.message, /Vérification en cours/);
});

test("stale needs_new_code is suppressed while resume request is active", () => {
  const projected = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    resumeRequestStatus: "running",
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "pending",
      resume_status: "needs_new_code",
    },
    lang: "fr",
  });
  assert.equal(projected.connect_status, "verification_resume_active");
  assert.equal(projected.action_required?.resume_status, "running");
  assert.doesNotMatch(projected.message, /nouveau code/);
  assert.match(projected.message, /Vérification en cours/);
});

test("needs_new_code remains visible when resume is not active", () => {
  const projected = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "action_required",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "pending",
      resume_status: "needs_new_code",
    },
    lang: "fr",
  });
  assert.equal(projected.action_required?.resume_status, "needs_new_code");
  assert.equal(projected.action_required?.can_submit_code, true);
});

test("login_email_code_resume eligibility allows active login_provisioning sibling request", () => {
  assert.match(runControlSource, /login_email_code_resume/);
  assert.match(runControlSource, /loginEmailCodeResumeAllowsActiveProvisioningConflict/);
  assert.match(runControlSource, /accountHasVerificationPausedLogin/);
  assert.match(submitService, /createLoginEmailCodeResumeRunRequest/);
  assert.match(submitRoute, /resume_request_status/);
});

test("password update banner is suppressed while email verification is active", () => {
  assert.match(pageSource, /enter_email_verification_code/);
  assert.match(pageSource, /verificationBlockedAccountIds/);
  assert.match(pageSource, /login_verification_pending/);
});

test("client submit route only promises resume when resume is queued", () => {
  assert.match(submitRoute, /resume_queued/);
  assert.match(submitRoute, /Vérification en cours/);
  assert.match(submitRoute, /Code enregistré/);
  assert.doesNotMatch(submitRoute, /open-botapp-phone|botapp:\/\//);
});
