import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const emailTemplateRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-templates/route.ts", import.meta.url),
  "utf8",
);
const emailHistoryRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-history/route.ts", import.meta.url),
  "utf8",
);
const emailHistoryDetailRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-history/[intentId]/route.ts", import.meta.url),
  "utf8",
);
const clientNotificationsRoute = readFileSync(
  new URL("../../app/api/instagram-client/notifications/route.ts", import.meta.url),
  "utf8",
);

test("email relay routes require relay or admin auth", () => {
  assert.match(emailTemplateRoute, /requireRelayOrAdmin/);
  assert.match(emailHistoryRoute, /requireRelayOrAdmin/);
  assert.match(emailHistoryDetailRoute, /requireRelayOrAdmin/);
});

test("email relay routes never use client instagram session", () => {
  for (const source of [emailTemplateRoute, emailHistoryRoute, emailHistoryDetailRoute]) {
    assert.doesNotMatch(source, /requireClientInstagramSession/);
  }
});

test("client notifications route stays isolated from email history relay", () => {
  assert.match(clientNotificationsRoute, /requireClientInstagramSession/);
  assert.doesNotMatch(clientNotificationsRoute, /email-history/);
  assert.doesNotMatch(clientNotificationsRoute, /email-templates/);
});

test("email history relay route keeps client dashboard isolated", () => {
  assert.match(emailHistoryRoute, /requireRelayOrAdmin/);
  assert.doesNotMatch(emailHistoryRoute, /requireClientInstagramSession/);
  assert.doesNotMatch(emailHistoryRoute, /client_id/);
  assert.match(emailHistoryRoute, /client_email/);
});

test("template save route rejects forbidden provider fields", () => {
  assert.match(emailTemplateRoute, /rejectForbiddenEmailTemplateFields/);
  assert.doesNotMatch(emailTemplateRoute, /provider_api_key/);
});
