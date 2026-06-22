import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mapProgressToClientConnectStatus,
  projectClientConnectProgress,
} from "./connect-progress-projection.ts";
import { createOpenDeviceViewIntent, verifyOpenDeviceViewIntent } from "./open-botapp-phone-intent.ts";

const progressRoute = readFileSync(
  new URL("../../app/api/instagram-client/accounts/[accountId]/connect/progress/route.ts", import.meta.url),
  "utf8",
);
const openPhoneRoute = readFileSync(
  new URL("../../app/api/instagram-client/accounts/[accountId]/open-botapp-phone/route.ts", import.meta.url),
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

test("connect progress maps code_submitted to verification_code_submitted", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "action_required",
    actionRequired: {
      action_type: "enter_email_verification_code",
      status: "code_submitted",
    },
  });
  assert.equal(status, "verification_code_submitted");
});

test("client connect progress route is client-gated and login_provisioning scoped", () => {
  assert.match(progressRoute, /requireClientInstagramSession/);
  assert.match(progressRoute, /authorizeClientInstagramAccount/);
  assert.match(loadProgress, /login_provisioning/);
  assert.match(loadProgress, /enter_email_verification_code/);
});

test("verification modal uses dedicated client submit route", () => {
  assert.match(verificationModal, /\/connect\/submit-verification-code/);
  assert.doesNotMatch(verificationModal, /dashboard-actions\/submit-verification-code/);
  assert.match(verificationModal, /Vérification requise/);
  assert.match(verificationModal, /Valider le code/);
  assert.match(verificationModal, /Ouvrir le téléphone dans BotApp/);
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
  assert.doesNotMatch(submitRoute, /resume_request_id|device_serial|adb_serial|vault|password/i);
});

test("open phone route creates bounded intent without exposing device serial to client", () => {
  const intentSource = readFileSync(
    new URL("./open-botapp-phone-intent.ts", import.meta.url),
    "utf8",
  );
  assert.match(openPhoneRoute, /createOpenDeviceViewIntent/);
  assert.match(openPhoneRoute, /loadAssignedDeviceForAccount/);
  assert.match(openPhoneRoute, /open_url: intent\.open_url/);
  assert.doesNotMatch(openPhoneRoute, /adb_serial|device_serial/);
  assert.match(intentSource, /botapp:\/\/open-device-view/);
});

test("botapp redeem route is relay-only and forbids arbitrary device selection", () => {
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
  assert.match(clientSection, /open-botapp-phone/);
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
