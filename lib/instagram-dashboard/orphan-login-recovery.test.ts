import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  clientSecurePreparationMessage,
  ORPHAN_RECOVERY_RUN_TYPE,
} from "../instagram-dashboard/orphan-login-recovery.ts";
import {
  clientReadinessAllowsConnect,
  clientReadinessMessage,
  projectClientReadinessStatus,
} from "../instagram-client/client-readiness-projection.ts";

test("orphan recovery run type is technical only", () => {
  const runControlSource = readFileSync(new URL("../instagram-dashboard/run-control.ts", import.meta.url), "utf8");
  assert.match(runControlSource, /login_orphan_challenge_recovery/);
  assert.doesNotMatch(
    readFileSync(new URL("../instagram-client/enqueue-client-connect.ts", import.meta.url), "utf8"),
    /login_orphan_challenge_recovery/,
  );
});

test("client secure preparation status blocks connect", () => {
  const status = projectClientReadinessStatus({
    audience: "client",
    readiness_status: "retry_later",
    client_status: "try_again_later",
    client_message: clientSecurePreparationMessage("fr"),
    preflight_request_created: false,
    idempotent: false,
    next_action: "wait_for_secure_preparation",
    reason: "orphan_login_challenge_pending",
    orphan_recovery: {
      state: "orphan_challenge_detected",
      blocking_client: true,
      botapp_action_available: true,
      detected_at: "2026-06-24T10:00:00+00:00",
      has_active_login_provisioning: false,
    },
  });
  assert.equal(status, "secure_preparation_in_progress");
  assert.equal(clientReadinessMessage(status, "fr"), "La préparation sécurisée de votre compte est en cours.");
  assert.equal(clientReadinessAllowsConnect(status), false);
});

test("restore login screen route is relay-only and scoped to account", () => {
  const routeSource = readFileSync(
    new URL("../../app/api/instagram-dashboard/accounts/[accountId]/restore-login-screen/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(routeSource, /verifyCompassRelayKey/);
  assert.match(routeSource, /Restore login screen is only available through the BotApp relay/);
  assert.match(routeSource, /ORPHAN_RECOVERY_RUN_TYPE/);
  assert.doesNotMatch(routeSource, /instagram-client/);
});

test("botapp exposes restore login screen action separately from auto login", () => {
  const toolbarSource = readFileSync(
    new URL("../../../BotApp/src/views/profiles/ProfileToolbar.tsx", import.meta.url),
    "utf8",
  );
  const profilesSource = readFileSync(
    new URL("../../../BotApp/src/views/profiles/ProfilesView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(toolbarSource, /restore_login_screen/);
  assert.match(profilesSource, /restoreLoginScreen/);
  assert.match(profilesSource, /Restore login screen/);
  assert.doesNotMatch(profilesSource, /restoreLoginScreen[\s\S]*connectClientInstagramAccount/);
});
