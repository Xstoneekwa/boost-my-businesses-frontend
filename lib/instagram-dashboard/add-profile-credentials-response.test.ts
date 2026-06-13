import assert from "node:assert/strict";
import test from "node:test";

import {
  isAddProfileCredentialsSaved,
  resolveAddProfileCredentialStatus,
  resolveAddProfileCredentialsResponse,
} from "./add-profile-credentials-response.ts";

test("add profile credentials treat active row with reauth_required as saved", () => {
  const credentials = {
    credentials_status: "active",
    status: "active",
    reauth_required: true,
  };
  assert.equal(isAddProfileCredentialsSaved(credentials), true);
  assert.equal(resolveAddProfileCredentialStatus(credentials), "saved_pending_verification");
  assert.deepEqual(resolveAddProfileCredentialsResponse({ credentials, credentialsSubmitted: true }), {
    credentials_configured: true,
    credential_status: "saved_pending_verification",
    credential_save_status: "saved",
  });
});

test("add profile credentials treat saved_pending_verification as configured", () => {
  const credentials = {
    credentials_status: "saved_pending_verification",
    status: "active",
    reauth_required: false,
  };
  assert.equal(isAddProfileCredentialsSaved(credentials), true);
  assert.equal(resolveAddProfileCredentialStatus(credentials), "saved_pending_verification");
});

test("add profile credentials missing submission stays not provided", () => {
  assert.deepEqual(resolveAddProfileCredentialsResponse({ credentialsSubmitted: false }), {
    credentials_configured: false,
    credential_status: "not_submitted",
    credential_save_status: "not_provided",
  });
});
