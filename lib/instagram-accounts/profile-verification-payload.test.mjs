import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  profileVerificationPayloadForInsert,
  publicProfileMetadataForLookup,
  verificationReasonForLookup,
  verificationStatusForLookup,
} from "./profile-verification-payload.ts";
import { clientSafeProcessErrorMessage } from "../instagram-client/client-account-process-projection.ts";

const FOUND_LOOKUP = {
  ok: true,
  status: "found",
  input_username: "demo_user",
  canonical_username: "demo_user",
  instagram_user_id: "12345",
  external_profile_id: "ext-1",
  avatar_url: "https://cdn.example/avatar.jpg",
  is_private: false,
  is_verified: true,
  followers_count: 1200,
  reason: "found",
  checked_at: "2026-06-21T12:00:00.000Z",
  metadata: { provider: "search_api" },
};

const SHARED_CONTEXT = {
  operation: "add_profile",
  sourceSurface: "admin_dashboard",
};

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("profile verification helpers map found lookup to canonical ig_accounts fields", () => {
  const payload = profileVerificationPayloadForInsert(FOUND_LOOKUP, SHARED_CONTEXT);

  assert.equal(payload.username_verification_status, "verified");
  assert.equal(payload.username_verified_at, "2026-06-21T12:00:00.000Z");
  assert.equal(payload.username_verification_reason, "found");
  assert.equal(payload.instagram_user_id, "12345");
  assert.equal(payload.external_profile_id, "ext-1");
  assert.equal(payload.is_private, false);
  assert.equal(payload.is_verified, true);
  assert.equal(payload.followers_count, 1200);
  assert.equal(payload.avatar_url, "https://cdn.example/avatar.jpg");
  assert.equal(payload.avatar_checked_at, "2026-06-21T12:00:00.000Z");
  assert.equal(payload.public_profile_metadata.source, "add_profile");
  assert.equal(payload.public_profile_metadata.source_surface, "admin_dashboard");
  assert.equal(payload.public_profile_metadata.canonical_username, "demo_user");
});

test("client and admin produce identical payload for found lookup with shared context", () => {
  const adminPayload = profileVerificationPayloadForInsert(FOUND_LOOKUP, SHARED_CONTEXT);
  const clientPayload = profileVerificationPayloadForInsert(FOUND_LOOKUP, SHARED_CONTEXT);
  assert.deepEqual(clientPayload, adminPayload);
});

test("payload never includes deprecated instagram_verification fields", () => {
  const payload = profileVerificationPayloadForInsert(FOUND_LOOKUP, SHARED_CONTEXT);
  const keys = Object.keys(payload).sort();
  assert.equal(keys.includes("instagram_verification_status"), false);
  assert.equal(keys.includes("instagram_verified_at"), false);
  assert.match(JSON.stringify(payload), /username_verification_status/);
  assert.match(JSON.stringify(payload), /username_verified_at/);
  assert.match(JSON.stringify(payload), /username_verification_reason/);
});

test("verification status and reason helpers stay aligned with admin semantics", () => {
  assert.equal(verificationStatusForLookup(FOUND_LOOKUP), "verified");
  assert.equal(verificationReasonForLookup(FOUND_LOOKUP), "found");
  assert.equal(
    verificationStatusForLookup({ ...FOUND_LOOKUP, status: "username_invalid" }),
    "invalid_format",
  );
  assert.equal(
    publicProfileMetadataForLookup(FOUND_LOOKUP, SHARED_CONTEXT).provider_status,
    "found",
  );
});

test("client and admin routes import the shared profile verification helper", () => {
  const clientSource = source("../instagram-client/create-account.ts");
  const adminSource = source("../../app/api/instagram-dashboard/accounts/create/route.ts");
  const helperSource = source("./profile-verification-payload.ts");

  assert.match(clientSource, /profileVerificationPayloadForInsert/);
  assert.match(adminSource, /profileVerificationPayloadForInsert/);
  assert.doesNotMatch(clientSource, /instagram_verification_status/);
  assert.doesNotMatch(clientSource, /instagram_verified_at/);
  assert.doesNotMatch(adminSource, /function profileVerificationPayload\(/);
  assert.doesNotMatch(helperSource, /instagram_verification_status/);
});

test("account_create_failed stays client-safe without postgres details", () => {
  const message = clientSafeProcessErrorMessage("fr", "account_create_failed", "Could not create Instagram account.");
  assert.match(message, /Impossible d'ajouter le compte pour le moment/i);
  assert.doesNotMatch(message, /PGRST|postgres|column|schema/i);
});
