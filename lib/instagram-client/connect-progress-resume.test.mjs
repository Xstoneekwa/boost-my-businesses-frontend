import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveClientAccountState } from "./client-account-state.ts";
import {
  isActiveClientConnectStatus,
  isTerminalClientConnectProgress,
  shouldBlockClientConnect,
  shouldSuppressPassiveReadyToConnect,
} from "./connect-operation-state.ts";
import { mapProgressToClientConnectStatus, projectClientConnectProgress } from "./connect-progress-projection.ts";

const clientSection = readFileSync(
  new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
  "utf8",
);
const loadAccounts = readFileSync(
  new URL("./load-client-instagram-accounts.ts", import.meta.url),
  "utf8",
);
const loadProgress = readFileSync(
  new URL("./load-client-connect-progress.ts", import.meta.url),
  "utf8",
);

test("active connect status suppresses passive ready_to_connect presentation", () => {
  const ui = resolveClientAccountState({
    clientReadinessStatus: "ready_to_connect",
    activeConnectStatus: "verification_required",
    connected: false,
  }, "fr");

  assert.equal(ui.badgeLabel, "Vérification requise");
  assert.equal(ui.connectDisabled, true);
  assert.equal(ui.connectPrimary, false);
  assert.equal(ui.showVerificationReopen, true);
});

test("running login provisioning disables connect button after refresh", () => {
  const ui = resolveClientAccountState({
    clientReadinessStatus: "ready_to_connect",
    activeConnectStatus: "running",
    connected: false,
  }, "fr");

  assert.equal(ui.badgeLabel, "Connexion en cours");
  assert.equal(ui.connectDisabled, true);
  assert.equal(ui.connectPrimary, false);
});

test("queued login provisioning keeps card in async pending state", () => {
  const ui = resolveClientAccountState({
    clientReadinessStatus: "ready_to_connect",
    activeConnectStatus: "queued",
    connected: false,
  }, "fr");

  assert.equal(ui.connectDisabled, true);
  assert.equal(ui.isAsyncPending, true);
});

test("terminal cancelled connect returns to passive readiness when no active status", () => {
  const ui = resolveClientAccountState({
    clientReadinessStatus: "ready_to_connect",
    connected: false,
  }, "fr");

  assert.equal(ui.badgeLabel, "Prêt à connecter");
  assert.equal(ui.connectDisabled, false);
});

test("connect progress loader only tracks active login_provisioning requests", () => {
  assert.match(loadProgress, /\.in\("status", \["queued", "claimed", "starting", "running"\]\)/);
  assert.doesNotMatch(loadProgress, /if \(!requestRow && !input\.requestId\)/);
});

test("accounts loader enriches rows with active connect status from server progress", () => {
  assert.match(loadAccounts, /loadClientConnectProgress/);
  assert.match(loadAccounts, /activeConnectStatus/);
  assert.match(loadAccounts, /shouldSuppressPassiveReadyToConnect/);
});

test("client dashboard hydrates active connect on initial load without prior click", () => {
  assert.match(clientSection, /connectHydratedRef/);
  assert.match(clientSection, /resumeActiveConnect/);
  assert.match(clientSection, /activeConnectStatus/);
  assert.match(clientSection, /showVerificationReopen/);
});

test("verification_required snapshot stays active across reload semantics", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "action_required",
    requestStatus: "running",
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
  assert.equal(isActiveClientConnectStatus(snapshot.connect_status), true);
  assert.equal(shouldBlockClientConnect(snapshot.connect_status), true);
  assert.equal(shouldSuppressPassiveReadyToConnect(snapshot.connect_status), true);
  assert.equal(isTerminalClientConnectProgress(snapshot), false);
});

test("running snapshot without challenge still blocks second connect", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "running",
    requestStatus: "running",
    runStatus: "running",
  });
  assert.equal(status, "running");
  assert.equal(shouldBlockClientConnect(status), true);
});

test("hydrated client section exposes verification reopen CTA after modal dismiss", () => {
  assert.match(clientSection, /handleReopenVerification/);
  assert.match(clientSection, /setVerificationDismissed\(true\)/);
  assert.match(clientSection, /ClientVerificationModal/);
});
