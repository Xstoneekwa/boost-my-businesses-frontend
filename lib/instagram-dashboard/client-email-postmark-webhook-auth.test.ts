import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBasicAuthHeader,
  verifyPostmarkWebhookBasicAuth,
} from "./client-email-postmark-webhook-auth.ts";

test("basic auth parser extracts username and password", () => {
  const token = Buffer.from("hook-user:hook-pass", "utf8").toString("base64");
  const parsed = parseBasicAuthHeader(`Basic ${token}`);
  assert.deepEqual(parsed, { username: "hook-user", password: "hook-pass" });
});

test("webhook auth rejects missing authorization", () => {
  const auth = verifyPostmarkWebhookBasicAuth(null, {
    POSTMARK_WEBHOOK_USERNAME: "hook-user",
    POSTMARK_WEBHOOK_PASSWORD: "hook-pass",
  });
  assert.equal(auth.ok, false);
  if (auth.ok) return;
  assert.equal(auth.reason, "auth_required");
});

test("webhook auth rejects invalid credentials", () => {
  const token = Buffer.from("hook-user:wrong-pass", "utf8").toString("base64");
  const auth = verifyPostmarkWebhookBasicAuth(`Basic ${token}`, {
    POSTMARK_WEBHOOK_USERNAME: "hook-user",
    POSTMARK_WEBHOOK_PASSWORD: "hook-pass",
  });
  assert.equal(auth.ok, false);
  if (auth.ok) return;
  assert.equal(auth.reason, "auth_invalid");
});

test("webhook auth accepts valid credentials", () => {
  const token = Buffer.from("hook-user:hook-pass", "utf8").toString("base64");
  const auth = verifyPostmarkWebhookBasicAuth(`Basic ${token}`, {
    POSTMARK_WEBHOOK_USERNAME: "hook-user",
    POSTMARK_WEBHOOK_PASSWORD: "hook-pass",
  });
  assert.equal(auth.ok, true);
});
