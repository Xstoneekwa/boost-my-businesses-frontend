import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createConnectOperationToken,
  decodeConnectOperationTokenForTests,
  verifyConnectOperationToken,
} from "./connect-operation-token.ts";

const loadProgress = readFileSync(new URL("./load-client-connect-progress.ts", import.meta.url), "utf8");
const connectAccount = readFileSync(new URL("./connect-account.ts", import.meta.url), "utf8");
const tokenSource = readFileSync(new URL("./connect-operation-token.ts", import.meta.url), "utf8");
const clientSection = readFileSync(
  new URL("../../app/instagram-client/ClientAccountsSection.tsx", import.meta.url),
  "utf8",
);

const INTERNAL_IDS = [
  "871c5836-0fb4-4afb-a5c7-b8bb3fc6b74c",
  "9566321d-bc00-422f-ae5a-edf712b569e8",
  "0472ebb3-1111-2222-3333-444455556666",
  "088fd921-7777-8888-9999-000011112222",
];

function decodeAllBase64urlSegments(token) {
  return token.split(".").flatMap((segment) => {
    try {
      return [Buffer.from(segment, "base64url").toString("utf8")];
    } catch {
      return [];
    }
  });
}

test("connect operation token is encrypted, bounded, and not decodable in the browser", () => {
  process.env.INSTAGRAM_CLIENT_INTENT_SECRET = "test-connect-operation-secret";
  const created = createConnectOperationToken({
    accountId: INTERNAL_IDS[0],
    actorUserId: "auth-user-2222-3333-4444-555566667777",
    connectAttemptId: INTERNAL_IDS[2],
    requestId: INTERNAL_IDS[1],
    now: new Date("2026-06-24T12:00:00.000Z"),
  });
  assert.ok(created?.connect_operation_token);
  assert.match(created.connect_operation_token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  for (const segment of decodeAllBase64urlSegments(created.connect_operation_token)) {
    for (const id of INTERNAL_IDS) {
      assert.doesNotMatch(segment, new RegExp(id.replace(/-/g, "\\-")));
    }
    assert.doesNotMatch(segment, /auth-user-2222-3333-4444-555566667777/);
    assert.doesNotMatch(segment, /connect_attempt_id|account_id|request_id|actor_user_id/);
  }

  const verified = verifyConnectOperationToken(created.connect_operation_token, {
    accountId: INTERNAL_IDS[0],
    actorUserId: "auth-user-2222-3333-4444-555566667777",
  }, new Date("2026-06-24T12:05:00.000Z"));
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.payload.connect_attempt_id, INTERNAL_IDS[2]);
    assert.equal(verified.payload.request_id, INTERNAL_IDS[1]);
  }
});

test("token implementation uses authenticated encryption instead of signed plaintext payload", () => {
  assert.match(tokenSource, /aes-256-gcm/);
  assert.match(tokenSource, /createCipheriv/);
  assert.match(tokenSource, /createDecipheriv/);
  assert.doesNotMatch(tokenSource, /encodePayload/);
  assert.doesNotMatch(tokenSource, /createHmac/);
});

test("expired, tampered, and mismatched connect operation tokens are rejected client-safe", () => {
  process.env.INSTAGRAM_CLIENT_INTENT_SECRET = "test-connect-operation-secret";
  const created = createConnectOperationToken({
    accountId: INTERNAL_IDS[0],
    actorUserId: "auth-user-2222-3333-4444-555566667777",
    connectAttemptId: INTERNAL_IDS[2],
    requestId: INTERNAL_IDS[1],
    now: new Date("2026-06-24T12:00:00.000Z"),
  });

  const expired = verifyConnectOperationToken(created.connect_operation_token, {
    accountId: INTERNAL_IDS[0],
    actorUserId: "auth-user-2222-3333-4444-555566667777",
  }, new Date("2026-06-24T15:00:01.000Z"));
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, "connect_operation_expired");

  const wrongAccount = verifyConnectOperationToken(created.connect_operation_token, {
    accountId: INTERNAL_IDS[1],
    actorUserId: "auth-user-2222-3333-4444-555566667777",
  }, new Date("2026-06-24T12:05:00.000Z"));
  assert.equal(wrongAccount.ok, false);
  if (!wrongAccount.ok) assert.equal(wrongAccount.reason, "connect_operation_account_mismatch");

  const wrongActor = verifyConnectOperationToken(created.connect_operation_token, {
    accountId: INTERNAL_IDS[0],
    actorUserId: "other-user-9999-8888-7777-666655554444",
  }, new Date("2026-06-24T12:05:00.000Z"));
  assert.equal(wrongActor.ok, false);
  if (!wrongActor.ok) assert.equal(wrongActor.reason, "connect_operation_actor_mismatch");

  const parts = created.connect_operation_token.split(".");
  parts[2] = `${parts[2].slice(0, -1)}X`;
  const tampered = verifyConnectOperationToken(parts.join("."), {
    accountId: INTERNAL_IDS[0],
    actorUserId: "auth-user-2222-3333-4444-555566667777",
  }, new Date("2026-06-24T12:05:00.000Z"));
  assert.equal(tampered.ok, false);
  if (!tampered.ok) assert.equal(tampered.reason, "connect_operation_invalid_payload");
});

test("progress loader only uses terminal fallback with correlated attempt token", () => {
  assert.match(loadProgress, /verifyConnectOperationToken/);
  assert.match(loadProgress, /loadLoginProvisioningRequestByAttemptId/);
  assert.doesNotMatch(loadProgress, /latestTerminal/);
  assert.doesNotMatch(loadProgress, /loadLatestLoginProvisioningRequest/);
});

test("connect POST mints operation token and client polling forwards it", () => {
  assert.match(connectAccount, /createConnectOperationToken/);
  assert.match(connectAccount, /connect_operation_token/);
  assert.match(clientSection, /connectOperationToken/);
  assert.match(clientSection, /connect_operation_token/);
});

test("server-side decode helper remains test-only and restores correlation after encryption", () => {
  process.env.INSTAGRAM_CLIENT_INTENT_SECRET = "test-connect-operation-secret";
  const created = createConnectOperationToken({
    accountId: INTERNAL_IDS[0],
    actorUserId: "auth-user-2222-3333-4444-555566667777",
    connectAttemptId: INTERNAL_IDS[2],
    requestId: INTERNAL_IDS[1],
  });
  const decoded = decodeConnectOperationTokenForTests(created.connect_operation_token);
  assert.equal(decoded?.connect_attempt_id, INTERNAL_IDS[2]);
  assert.equal(decoded?.request_id, INTERNAL_IDS[1]);
});
