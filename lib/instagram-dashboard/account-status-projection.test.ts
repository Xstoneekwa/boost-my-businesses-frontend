import assert from "node:assert/strict";
import test from "node:test";

import {
  credentialStatusLabel,
  projectCredentialBusinessStatus,
} from "./account-status-projection.ts";

test("credential projection maps active reauth credentials to saved pending verification", () => {
  const status = projectCredentialBusinessStatus({
    credentialsConfigured: true,
    credentialsStatus: "active",
    reauthRequired: true,
    secretRefPresent: true,
  });

  assert.equal(status, "saved_pending_verification");
  assert.equal(credentialStatusLabel(status), "credentials saved - login pending");
});

test("credential projection does not show missing when credentials are active", () => {
  assert.notEqual(projectCredentialBusinessStatus({
    credentialsConfigured: true,
    credentialsStatus: "active",
    reauthRequired: false,
    secretRefPresent: true,
  }), "missing");
});

test("credential projection requires secret ref when the caller can verify it", () => {
  assert.equal(projectCredentialBusinessStatus({
    credentialsConfigured: true,
    credentialsStatus: "active",
    reauthRequired: true,
    secretRefPresent: false,
  }), "unknown");
});
