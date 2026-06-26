import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mapProgressToClientConnectStatus,
  projectClientConnectProgress,
} from "./connect-progress-projection.ts";
import { isActiveClientConnectStatus, isTerminalClientConnectProgress } from "./connect-operation-state.ts";
import { createOpenDeviceViewIntent, verifyOpenDeviceViewIntent } from "./open-botapp-phone-intent.ts";

const progressRoute = readFileSync(
  new URL("../../app/api/instagram-client/accounts/[accountId]/connect/progress/route.ts", import.meta.url),
  "utf8",
);
const botappRedeemRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/botapp/open-device-view/route.ts", import.meta.url),
  "utf8",
);
const submitRoute = readFileSync(
  new URL("../../app/api/instagram-client/accounts/[accountId]/connect/submit-verification-code/route.ts", import.meta.url),
  "utf8",
);
const submitService = readFileSync(
  new URL("../instagram-dashboard/submit-verification-code-service.ts", import.meta.url),
  "utf8",
);
const adminSubmitRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/dashboard-actions/submit-verification-code/route.ts", import.meta.url),
  "utf8",
);
const clientSection = readFileSync(
  new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
  "utf8",
);
const processModal = readFileSync(
  new URL("../../app/instagram-client/ClientAccountProcessModal.tsx", import.meta.url),
  "utf8",
);
const verificationModal = readFileSync(
  new URL("../../app/instagram-client/ClientVerificationModal.tsx", import.meta.url),
  "utf8",
);
const loadProgress = readFileSync(
  new URL("./load-client-connect-progress.ts", import.meta.url),
  "utf8",
);

test("connect progress maps runtime verification_required from dashboard action", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "action_required",
    actionRequired: {
      action_type: "enter_email_verification_code",
      status: "pending",
    },
  });
  assert.equal(status, "verification_required");
});

test("connect progress maps canonical account verification with active login chain", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "running",
    requestStatus: "running",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: true,
  });
  assert.equal(status, "verification_required");
});

test("connect progress maps checkpoint challenge to verification_required", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "action_required",
    actionRequired: {
      action_type: "resolve_checkpoint",
      status: "pending",
    },
  });
  assert.equal(status, "verification_required");
});

test("connect progress maps 2FA challenge to verification_required", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "action_required",
    actionRequired: {
      action_type: "complete_two_factor",
      status: "pending",
    },
  });
  assert.equal(status, "verification_required");
});

test("real terminal failure is not masked as verification_required", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "failed",
    requestStatus: "failed",
    runStatus: "failed",
    loginStatus: "logged_out",
    provisioningStatus: "login_pending",
  });
  assert.equal(status, "failed");
});

test("connect progress maps code_submitted without resume to verification_code_accepted", () => {
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

test("connect progress maps code_submitted with resume to verification_resume_active", () => {
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

test("client connect progress route is client-gated and login_provisioning scoped", () => {
  assert.match(progressRoute, /requireClientInstagramSession/);
  assert.match(progressRoute, /authorizeClientInstagramAccount/);
  assert.match(loadProgress, /login_provisioning/);
  assert.match(loadProgress, /enter_email_verification_code/);
  assert.match(loadProgress, /isCanonicalVerificationPending/);
  assert.match(loadProgress, /client_instagram_accounts/);
});

test("verification modal uses dedicated client submit route without phone CTA", () => {
  assert.match(verificationModal, /\/connect\/submit-verification-code/);
  assert.doesNotMatch(verificationModal, /dashboard-actions\/submit-verification-code/);
  assert.match(verificationModal, /Vérification requise/);
  assert.match(verificationModal, /Valider le code/);
  assert.doesNotMatch(verificationModal, /Ouvrir le téléphone dans BotApp|Open phone in BotApp|botapp:\/\//);
  assert.doesNotMatch(verificationModal, /verification_code.*console|localStorage/i);
});

test("client submit route delegates to canonical verification service", () => {
  assert.match(submitRoute, /requireClientInstagramSession/);
  assert.match(submitRoute, /authorizeClientInstagramAccount/);
  assert.match(submitRoute, /submitAccountVerificationCode/);
  assert.match(submitService, /submit_account_verification_code/);
  assert.match(submitService, /assertActiveEmailVerificationAction/);
  assert.match(submitService, /createLoginEmailCodeResumeRunRequest/);
  assert.match(adminSubmitRoute, /submitAccountVerificationCode/);
  assert.doesNotMatch(submitRoute, /device_serial|adb_serial|vault|password/i);
});

test("admin botapp redeem route stays relay-only and separate from client dashboard", () => {
  assert.match(botappRedeemRoute, /verifyCompassRelayKey/);
  assert.match(botappRedeemRoute, /allow_device_selection:\s*false/);
  assert.match(botappRedeemRoute, /allow_run_start:\s*false/);
  assert.match(botappRedeemRoute, /allow_assignment:\s*false/);
  assert.match(botappRedeemRoute, /loadAssignedDeviceForAccount/);
});

test("client connect section polls runtime progress and opens verification modal", () => {
  assert.match(clientSection, /connect\/progress/);
  assert.match(clientSection, /ClientVerificationModal/);
  assert.match(clientSection, /verification_required/);
  assert.doesNotMatch(clientSection, /open-botapp-phone|botapp:\/\//);
  assert.match(clientSection, /resumeActiveConnect/);
  assert.match(clientSection, /activeConnectStatus/);
});

test("submit verification code keeps client ownership check and canonical RPC", () => {
  assert.match(submitService, /submit_account_verification_code/);
  assert.match(submitRoute, /authorizeClientInstagramAccount/);
  assert.match(adminSubmitRoute, /client_can_manage_instagram_account/);
  assert.match(submitService, /createLoginEmailCodeResumeRunRequest/);
});

test("open device intent signs and verifies without echoing secrets", () => {
  const previous = process.env.BOTAPP_RELAY_API_KEY;
  process.env.BOTAPP_RELAY_API_KEY = "test-relay-key-for-intent-signing";
  try {
    const created = createOpenDeviceViewIntent({
      accountId: "871c5836-0fb4-4afb-a5c7-b8bb3fc6b74c",
      actorUserId: "user-1",
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    assert.ok(created?.intent_token);
    const verified = verifyOpenDeviceViewIntent(created.intent_token, new Date("2026-06-15T12:01:00.000Z"));
    assert.equal(verified.ok, true);
    assert.equal(verified.payload?.account_id, "871c5836-0fb4-4afb-a5c7-b8bb3fc6b74c");
  } finally {
    process.env.BOTAPP_RELAY_API_KEY = previous;
  }
});

test("projectClientConnectProgress exposes client-safe challenge metadata only", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "action_required",
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "pending",
      title: "Email verification code required",
      message: "Instagram is waiting for the email verification code.",
    },
    lang: "fr",
  });
  assert.equal(snapshot.connect_status, "verification_required");
  assert.equal(snapshot.action_required?.can_submit_code, true);
  assert.doesNotMatch(JSON.stringify(snapshot), /device_serial|adb_serial|vault|password|token/i);
});

test("projectClientConnectProgress keeps verification active when request stays running after challenge", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "action_required",
    requestStatus: "running",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "pending_verification",
      title: "Verification required",
      message: "Instagram is waiting for the email verification code.",
    },
    lang: "fr",
  });
  assert.equal(snapshot.connect_status, "verification_required");
  assert.equal(snapshot.request_status, "running");
  assert.equal(isTerminalClientConnectProgress(snapshot), false);
});

test("terminal connect progress never maps to active running status", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "unknown",
    requestStatus: "",
    runStatus: "",
    lang: "fr",
  });
  assert.equal(snapshot.connect_status, "not_created");
  assert.equal(snapshot.failed, false);
  assert.equal(isTerminalClientConnectProgress(snapshot), true);
  assert.equal(isActiveClientConnectStatus(snapshot.connect_status), false);
});

test("failed connect progress is terminal and not verification_required", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "failed",
    requestStatus: "failed",
    runStatus: "failed",
    loginStatus: "logged_out",
    provisioningStatus: "not_started",
    lang: "fr",
  });
  assert.equal(snapshot.connect_status, "failed");
  assert.equal(snapshot.failed, true);
  assert.equal(isTerminalClientConnectProgress(snapshot), true);
});

test("verification_required wins over failed request when canonical account status is pending", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "action_required",
    requestStatus: "failed",
    runStatus: "failed",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    actionRequired: {
      id: "action-1",
      action_type: "enter_email_verification_code",
      status: "pending",
      title: "Verification required",
      message: "Instagram is waiting for the email verification code.",
    },
    lang: "fr",
  });
  assert.equal(snapshot.connect_status, "verification_required");
  assert.equal(snapshot.failed, false);
  assert.equal(isTerminalClientConnectProgress(snapshot), false);
});

test("connect progress loader falls back to latest request during verification", () => {
  assert.match(loadProgress, /verificationPending/);
  assert.match(loadProgress, /loadLoginProvisioningRequestByAttemptId/);
});

test("connect progress loader uses correlated attempt token for terminal failed request", () => {
  assert.match(loadProgress, /verifyConnectOperationToken/);
  assert.match(loadProgress, /correlatedAttemptId/);
  assert.doesNotMatch(loadProgress, /loadLatestLoginProvisioningRequest/);
});

test("client process modal derives terminal error chip from runtime connect progress", () => {
  assert.match(processModal, /isTerminalConnectError/);
  assert.match(processModal, /runtimeStatus === "not_created"/);
  assert.match(processModal, /labelFor\(lang, "Erreur", "Error"\)/);
  assert.match(processModal, /labelForActiveConnectStatus/);
  assert.doesNotMatch(processModal, /projection\.statusChip[\s\S]*projection\.statusChip/);
});

test("client connect section keeps polling during long_running active connect", () => {
  assert.match(clientSection, /connectPhase === "long_running"/);
  assert.match(clientSection, /isTerminalConnectProgress/);
});
