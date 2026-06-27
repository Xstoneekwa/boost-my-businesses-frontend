import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_EMAIL_LOCKED_FROM } from "./client-email-constants.ts";
import {
  CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES,
  CLIENT_EMAIL_TEST_DEMO_VALUES,
} from "./client-email-constants.ts";
import { resolveClientEmailTransactionalSupportEmail } from "./client-email-transactional-support.ts";
import { buildTemplatePreview } from "./client-email-template-render.ts";

test("transactional support email resolves to growth@boostmybusinesses.com", () => {
  assert.equal(resolveClientEmailTransactionalSupportEmail(), CLIENT_EMAIL_LOCKED_FROM);
  assert.equal(resolveClientEmailTransactionalSupportEmail(), "growth@boostmybusinesses.com");
});

test("preview and test demo values use growth for support_email", () => {
  for (const values of [CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES, CLIENT_EMAIL_TEST_DEMO_VALUES]) {
    assert.equal(values.support_email, "growth@boostmybusinesses.com");
    assert.doesNotMatch(values.support_email, /support@boostmybusinesses.com/);
  }
});

test("support_email placeholder renders growth across demo preview", () => {
  const preview = buildTemplatePreview(
    "Help from {{support_email}}",
    "Contact {{support_email}} for assistance.",
  );
  assert.equal(preview.subject, "Help from growth@boostmybusinesses.com");
  assert.match(preview.bodyText, /growth@boostmybusinesses.com/);
  assert.doesNotMatch(preview.bodyText, /support@boostmybusinesses.com/);
});

test("all four categories share the same support_email resolver via demo values", () => {
  const categories = [
    "Account paused body {{support_email}}",
    "Account canceled body {{support_email}}",
    "Needs assistance body {{support_email}}",
    "Needs more targets body {{support_email}}",
  ];
  for (const body of categories) {
    const preview = buildTemplatePreview("Subject", body, CLIENT_EMAIL_TEST_DEMO_VALUES);
    assert.match(preview.bodyText, /growth@boostmybusinesses.com/);
  }
});
