import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_EMAIL_LOCKED_FROM } from "./client-email-constants.ts";
import {
  createPostmarkClientEmailAdapter,
  preparePostmarkSendRequest,
  validateClientEmailProviderSendPayload,
} from "./client-email-postmark-adapter.ts";

const basePayload = {
  intentId: "intent-1",
  fromEmail: CLIENT_EMAIL_LOCKED_FROM,
  recipientEmail: "owner@example.com",
  subject: "Subject",
  bodyText: "Text",
  bodyHtml: "<p>Text</p>",
  messageStream: "outbound" as const,
  category: "needs_assistance" as const,
  accountId: "acct-1",
  trigger: "manual" as const,
  reminderIndex: null,
};

test("provider disabled makes no Postmark network request", async () => {
  let fetchCalled = false;
  const adapter = createPostmarkClientEmailAdapter({
    CLIENT_EMAIL_PROVIDER: "postmark",
    CLIENT_EMAIL_SENDING_ENABLED: "false",
    POSTMARK_SERVER_TOKEN: "secret-token",
  }, async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  });

  const result = await adapter.send(basePayload);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "sending_disabled");
  assert.equal(fetchCalled, false);
});

test("missing token returns explicit redacted failure without network", async () => {
  let fetchCalled = false;
  const adapter = createPostmarkClientEmailAdapter({
    CLIENT_EMAIL_PROVIDER: "postmark",
    CLIENT_EMAIL_SENDING_ENABLED: "true",
  }, async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  });

  const result = await adapter.send(basePayload);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "postmark_token_missing");
  assert.match(result.message, /POSTMARK_SERVER_TOKEN/);
  assert.doesNotMatch(result.message, /secret-token/);
  assert.equal(fetchCalled, false);
});

test("from email is forced to growth@boostmybusinesses.com", async () => {
  const validation = validateClientEmailProviderSendPayload({
    ...basePayload,
    fromEmail: "other@example.com" as typeof CLIENT_EMAIL_LOCKED_FROM,
  });
  assert.equal(validation?.ok, false);
  if (!validation || validation.ok) return;
  assert.equal(validation.reason, "invalid_from_email");
});

test("recipient must be canonical communication email shape", async () => {
  const validation = validateClientEmailProviderSendPayload({
    ...basePayload,
    recipientEmail: "not-an-email",
  });
  assert.equal(validation?.ok, false);
  if (!validation || validation.ok) return;
  assert.equal(validation.reason, "invalid_recipient_email");
});

test("prepared Postmark request uses outbound stream and locked sender", () => {
  const prepared = preparePostmarkSendRequest(basePayload, "server-token");
  assert.equal(prepared.body.From, CLIENT_EMAIL_LOCKED_FROM);
  assert.equal(prepared.body.MessageStream, "outbound");
  assert.equal(prepared.body.TrackOpens, false);
  assert.equal(prepared.body.TrackLinks, "None");
  assert.deepEqual(prepared.body.Metadata, {
    intent_id: "intent-1",
    category: "needs_assistance",
    account_id: "acct-1",
    trigger: "manual",
    reminder_index: "",
  });
  assert.equal(prepared.headers["X-Postmark-Server-Token"], "server-token");
});

test("even with gate enabled TASK 6A blocks actual send call", async () => {
  let fetchCalled = false;
  const adapter = createPostmarkClientEmailAdapter({
    CLIENT_EMAIL_PROVIDER: "postmark",
    CLIENT_EMAIL_SENDING_ENABLED: "true",
    POSTMARK_SERVER_TOKEN: "server-token",
  }, async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  });

  const result = await adapter.send(basePayload);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "send_not_enabled_in_task_scope");
  assert.equal(fetchCalled, false);
});
