import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manage = readFileSync(
  new URL("../../app/instagram-dashboard/manage-data.ts", import.meta.url),
  "utf8",
);
const clientAccounts = readFileSync(
  new URL("../instagram-client/load-client-instagram-accounts.ts", import.meta.url),
  "utf8",
);
const clientWorkspace = readFileSync(
  new URL("../instagram-client/workspace-data.ts", import.meta.url),
  "utf8",
);

test("ADMIN_CLIENT_BOTAPP_PARITY begins with one Backend canonical login projection", () => {
  for (const source of [manage, clientAccounts, clientWorkspace]) {
    assert.match(source, /projectCanonicalLoginStatus/);
    assert.match(source, /login_identity_proof_status/);
    assert.match(source, /login_identity_profile_opened/);
    assert.match(source, /login_identity_username_match/);
    assert.match(source, /login_identity_verified_at/);
  }
});
