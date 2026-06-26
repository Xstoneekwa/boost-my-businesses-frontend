import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateConnectChallengeChainActive,
  findActiveVerificationAction,
  POST_CANCEL_LOGIN_STATUS,
  POST_CANCEL_PROVISIONING_STATUS,
} from "./connect-challenge-chain.ts";
import {
  mapProgressToClientConnectStatus,
  projectClientConnectProgress,
} from "./connect-progress-projection.ts";
import { isActiveClientConnectStatus } from "./connect-operation-state.ts";

const loadProgressSource = readFileSync(new URL("./load-client-connect-progress.ts", import.meta.url), "utf8");
const stopRouteSource = readFileSync(
  new URL("../../app/api/instagram-dashboard/stop/route.ts", import.meta.url),
  "utf8",
);
const clientSectionSource = readFileSync(
  new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
  "utf8",
);

test("challenge chain inactive when only stale account verification statuses remain", () => {
  assert.equal(
    evaluateConnectChallengeChainActive({
      requestStatus: "canceled",
      runStatus: "stopped",
      activeAction: null,
      resumeRequestStatus: "",
    }),
    false,
  );
});

test("challenge chain active with running login provisioning request", () => {
  assert.equal(
    evaluateConnectChallengeChainActive({
      requestStatus: "running",
      runStatus: "running",
      activeAction: null,
      resumeRequestStatus: "",
    }),
    true,
  );
});

test("stale verification statuses without active chain map to not_created", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "unknown",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: false,
  });
  assert.equal(status, "not_created");
});

test("real challenge still maps to verification_required when chain is active", () => {
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "running",
    requestStatus: "running",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: true,
    actionRequired: {
      action_type: "enter_email_verification_code",
      status: "pending",
      id: "action-1",
    },
  });
  assert.equal(status, "verification_required");
});

test("projected progress after cancel has no verification popup payload", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "unknown",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: false,
  });
  assert.equal(snapshot.connect_status, "not_created");
  assert.equal(snapshot.action_required, null);
  assert.equal(snapshot.verification.required, false);
  assert.equal(isActiveClientConnectStatus(snapshot.connect_status), false);
});

test("expired connect token with terminal canceled request stays neutral", () => {
  const snapshot = projectClientConnectProgress({
    accountId: "acc-1",
    overallStatus: "unknown",
    requestStatus: "canceled",
    runStatus: "stopped",
    requestId: "req-canceled",
    loginStatus: "verification_pending",
    provisioningStatus: "login_verification_pending",
    challengeChainActive: false,
  });
  assert.equal(snapshot.connect_status, "not_created");
  assert.equal(snapshot.action_required, null);
});

test("load progress requires active challenge chain before stale account statuses", () => {
  assert.match(loadProgressSource, /evaluateConnectChallengeChainActive/);
  assert.match(loadProgressSource, /challengeChainActive/);
  assert.match(loadProgressSource, /staleVerificationPending/);
});

test("stop route clears stale client connect projection after cancel", () => {
  assert.match(stopRouteSource, /clearStaleClientConnectChallengeProjection/);
  assert.match(stopRouteSource, /clear-stale-client-connect-projection/);
  assert.match(stopRouteSource, /client_connect_projection_cleared/);
});

test("post-cancel cleanup uses validated neutral account statuses", () => {
  assert.equal(POST_CANCEL_LOGIN_STATUS, "unknown");
  assert.equal(POST_CANCEL_PROVISIONING_STATUS, "not_started");
});

test("post-cancel cleanup clears legacy logged_out login_pending projection", () => {
  const cleanupSource = readFileSync(
    new URL("./clear-stale-client-connect-projection.ts", import.meta.url),
    "utf8",
  );
  assert.match(cleanupSource, /logged_out.*login_pending/s);
});

test("dismissed email verification action does not keep challenge chain active", () => {
  const dismissed = [{
    action_type: "enter_email_verification_code",
    status: "dismissed",
  }];
  assert.equal(findActiveVerificationAction(dismissed), null);
  assert.equal(
    evaluateConnectChallengeChainActive({
      requestStatus: "canceled",
      runStatus: "stopped",
      activeAction: findActiveVerificationAction(dismissed),
    }),
    false,
  );
  const status = mapProgressToClientConnectStatus({
    accountId: "acc-1",
    overallStatus: "unknown",
    loginStatus: "logged_out",
    provisioningStatus: "login_pending",
    challengeChainActive: false,
  });
  assert.equal(status, "not_created");
});

test("client accounts section only hydrates modal from active connect statuses", () => {
  assert.match(clientSectionSource, /isActiveClientConnectStatus\(row\.activeConnectStatus\)/);
  assert.match(clientSectionSource, /verification_required/);
  assert.match(clientSectionSource, /setVerificationDismissed\(true\)/);
});
