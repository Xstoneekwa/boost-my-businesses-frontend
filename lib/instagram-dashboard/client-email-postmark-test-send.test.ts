import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_EMAIL_LOCKED_FROM, CLIENT_EMAIL_TEST_DEMO_VALUES } from "./client-email-constants.ts";
import {
  executePostmarkTestDeliverySend,
  preparePostmarkTestSendRequest,
} from "./client-email-postmark-test-send.ts";

const openTestEnv = {
  CLIENT_EMAIL_SENDING_ENABLED: "false",
  CLIENT_EMAIL_TEST_SENDING_ENABLED: "true",
  CLIENT_EMAIL_TEST_RECIPIENT: "liam@example.com",
  CLIENT_EMAIL_PROVIDER: "postmark",
  POSTMARK_SERVER_TOKEN: "server-token",
};

const payload = {
  intentId: "intent-test-1",
  recipientEmail: "liam@example.com",
  fromEmail: CLIENT_EMAIL_LOCKED_FROM,
  subject: "Test subject",
  bodyText: "Hello Test Customer",
  bodyHtml: "<p>Hello Test Customer</p>",
  category: "needs_assistance" as const,
};

test("closed test gates make zero Postmark fetch", async () => {
  let fetchCalled = false;
  const result = await executePostmarkTestDeliverySend(payload, {}, async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  });
  assert.equal(result.ok, false);
  assert.equal(fetchCalled, false);
});

test("recipient not allowlisted is rejected without fetch", async () => {
  let fetchCalled = false;
  const result = await executePostmarkTestDeliverySend({
    ...payload,
    recipientEmail: "other@example.com",
  }, openTestEnv, async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "recipient_not_allowlisted");
  assert.equal(fetchCalled, false);
});

test("prepared Postmark test request uses configured sender and test metadata", () => {
  const prepared = preparePostmarkTestSendRequest(payload, "server-token");
  assert.equal(prepared.body.From, payload.fromEmail);
  assert.equal(prepared.body.MessageStream, "outbound");
  assert.equal(prepared.body.TrackOpens, false);
  assert.equal(prepared.body.TrackLinks, "None");
  assert.deepEqual(prepared.body.Metadata, {
    intent_id: "intent-test-1",
    is_test: "true",
    category: "needs_assistance",
    trigger: "manual_test",
  });
  assert.equal(prepared.headers["X-Postmark-Server-Token"], "server-token");
});

test("open test gates call Postmark once with demo-safe content", async () => {
  let fetchCalled = 0;
  let requestBody: Record<string, unknown> | null = null;
  const result = await executePostmarkTestDeliverySend({
    ...payload,
    bodyText: `Hello ${CLIENT_EMAIL_TEST_DEMO_VALUES.client_name}`,
  }, openTestEnv, async (_url, init) => {
    fetchCalled += 1;
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ MessageID: "pm-test-123" }), { status: 200 });
  });
  assert.equal(fetchCalled, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.providerMessageId, "pm-test-123");
  assert.equal(requestBody?.From, payload.fromEmail);
  assert.equal(requestBody?.To, "liam@example.com");
});

test("provider failure returns redacted error without retry", async () => {
  const result = await executePostmarkTestDeliverySend(payload, openTestEnv, async () => {
    return new Response(JSON.stringify({
      ErrorCode: 406,
      Message: "Invalid email liam@example.com with token 123456789012345",
    }), { status: 422 });
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "provider_error");
  assert.doesNotMatch(result.message, /123456789012345/);
  assert.match(result.message, /\[redacted-email\]/);
});
