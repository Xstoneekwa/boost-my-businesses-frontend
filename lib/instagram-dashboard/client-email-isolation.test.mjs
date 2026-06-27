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
const emailNeedsMorePreviewRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-needs-more-targets/preview/route.ts", import.meta.url),
  "utf8",
);
const emailLifecyclePreviewRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-lifecycle/preview/route.ts", import.meta.url),
  "utf8",
);
const emailDeliverySettingsRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-delivery-settings/route.ts", import.meta.url),
  "utf8",
);
const emailDeliverySettingsRefreshRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-delivery-settings/refresh-senders/route.ts", import.meta.url),
  "utf8",
);
const emailDeliverySettingsAuditRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/email-delivery-settings/audit/route.ts", import.meta.url),
  "utf8",
);
const clientNotificationsRoute = readFileSync(
  new URL("../../app/api/instagram-client/notifications/route.ts", import.meta.url),
  "utf8",
);
const postmarkWebhookRoute = readFileSync(
  new URL("../../app/api/webhooks/postmark/route.ts", import.meta.url),
  "utf8",
);

test("email relay routes require relay or admin auth", () => {
  assert.match(emailTemplateRoute, /requireRelayOrAdmin/);
  assert.match(emailHistoryRoute, /requireRelayOrAdmin/);
  assert.match(emailHistoryDetailRoute, /requireRelayOrAdmin/);
  assert.match(emailNeedsMorePreviewRoute, /requireRelayOrAdmin/);
  assert.match(emailLifecyclePreviewRoute, /requireRelayOrAdmin/);
  assert.match(emailDeliverySettingsRoute, /requireRelayOrAdmin/);
  assert.match(emailDeliverySettingsRefreshRoute, /requireRelayOrAdmin/);
  assert.match(emailDeliverySettingsAuditRoute, /requireRelayOrAdmin/);
});

test("email relay routes never use client instagram session", () => {
  for (const source of [
    emailTemplateRoute,
    emailHistoryRoute,
    emailHistoryDetailRoute,
    emailNeedsMorePreviewRoute,
    emailLifecyclePreviewRoute,
    emailDeliverySettingsRoute,
    emailDeliverySettingsRefreshRoute,
    emailDeliverySettingsAuditRoute,
  ]) {
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

test("delivery settings routes stay read-only on provider and never expose account token", () => {
  assert.match(emailDeliverySettingsRefreshRoute, /executePostmarkSenderIdentityRefresh/);
  assert.doesNotMatch(emailDeliverySettingsRoute, /POSTMARK_ACCOUNT_TOKEN/);
  assert.doesNotMatch(emailDeliverySettingsRefreshRoute, /POSTMARK_ACCOUNT_TOKEN/);
  assert.match(emailDeliverySettingsRoute, /Cache-Control: no-store|no-store/);
});

test("postmark webhook route uses basic auth and not relay admin session", () => {
  assert.match(postmarkWebhookRoute, /verifyPostmarkWebhookBasicAuth/);
  assert.doesNotMatch(postmarkWebhookRoute, /requireRelayOrAdmin/);
  assert.doesNotMatch(postmarkWebhookRoute, /requireClientInstagramSession/);
  assert.doesNotMatch(postmarkWebhookRoute, /POSTMARK_SERVER_TOKEN/);
});
