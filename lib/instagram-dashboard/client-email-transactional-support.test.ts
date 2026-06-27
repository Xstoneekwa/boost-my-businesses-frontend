import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_EMAIL_LOCKED_FROM } from "./client-email-constants.ts";
import {
  CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES,
  CLIENT_EMAIL_TEST_DEMO_VALUES,
} from "./client-email-constants.ts";
import { buildLegacyTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";
import { resolveClientEmailTransactionalSupportEmail } from "./client-email-transactional-support.ts";
import { buildTemplatePreview } from "./client-email-template-render.ts";
import { previewClientEmailTemplate } from "./client-email-templates.ts";

test("transactional support email resolves to growth legacy default", () => {
  assert.equal(resolveClientEmailTransactionalSupportEmail(), CLIENT_EMAIL_LOCKED_FROM);
  assert.equal(resolveClientEmailTransactionalSupportEmail(), "growth@boostmybusinesses.com");
});

test("transactional support email follows resolved settings", () => {
  const settings = {
    ...buildLegacyTransactionalDeliverySettings(),
    supportEmail: "ops@boostmybusinesses.com",
    source: "database" as const,
    schemaReady: true,
  };
  assert.equal(resolveClientEmailTransactionalSupportEmail(settings), "ops@boostmybusinesses.com");
});

test("preview and test demo constants still default to growth for legacy constants", () => {
  for (const values of [CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES, CLIENT_EMAIL_TEST_DEMO_VALUES]) {
    assert.equal(values.support_email, "growth@boostmybusinesses.com");
    assert.doesNotMatch(values.support_email, /support@boostmybusinesses.com/);
  }
});

test("support_email placeholder renders resolved support email across demo preview", () => {
  const settings = {
    ...buildLegacyTransactionalDeliverySettings(),
    supportEmail: "growth@boostmybusinesses.com",
  };
  const preview = previewClientEmailTemplate({
    subject: "Help from {{support_email}}",
    bodyText: "Contact {{support_email}} for assistance.",
    settings,
  });
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.equal(preview.preview.subject, "Help from growth@boostmybusinesses.com");
    assert.match(preview.preview.bodyText, /growth@boostmybusinesses.com/);
    assert.doesNotMatch(preview.preview.bodyText, /support@boostmybusinesses.com/);
  }
});

test("all four categories share the same support_email resolver via demo preview", () => {
  const settings = buildLegacyTransactionalDeliverySettings();
  const categories = [
    "Account paused body {{support_email}}",
    "Account canceled body {{support_email}}",
    "Needs assistance body {{support_email}}",
    "Needs more targets body {{support_email}}",
  ];
  for (const body of categories) {
    const preview = buildTemplatePreview(
      "Subject",
      body,
      { ...CLIENT_EMAIL_TEST_DEMO_VALUES, support_email: settings.supportEmail },
    );
    assert.match(preview.bodyText, /growth@boostmybusinesses.com/);
  }
});
