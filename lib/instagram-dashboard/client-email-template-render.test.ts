import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTemplatePreview,
  extractTemplateVariables,
  findUnknownTemplateVariables,
  textToSafeHtml,
  validateTemplateVariableUsage,
} from "./client-email-template-render.ts";

test("allowed variables pass validation", () => {
  const unknown = validateTemplateVariableUsage(
    "Hello {{client_name}}",
    "Account {{instagram_username}} has {{eligible_target_count}}/{{target_threshold}} targets.\nVisit {{dashboard_url}} or email {{support_email}}.",
  );
  assert.deepEqual(unknown, []);
});

test("unknown variables are rejected clearly", () => {
  const unknown = findUnknownTemplateVariables("Hi {{client_name}} and {{secret_code}}");
  assert.deepEqual(unknown, ["secret_code"]);
});

test("preview uses safe demonstration values", () => {
  const preview = buildTemplatePreview(
    "Targets for {{instagram_username}}",
    "Hello {{client_name}}, you have {{eligible_target_count}} targets. Email {{support_email}}.",
  );
  assert.match(preview.subject, /xstonekwa_backup_acc/);
  assert.match(preview.bodyText, /Acme Growth Co/);
  assert.match(preview.bodyText, /growth@boostmybusinesses.com/);
  assert.doesNotMatch(preview.bodyHtml, /<script/i);
  assert.doesNotMatch(preview.bodyText, /support@boostmybusinesses.com/);
});

test("text to safe html escapes dangerous markup", () => {
  const html = textToSafeHtml("<script>alert(1)</script>\n\nSafe line");
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("extractTemplateVariables returns unique names", () => {
  assert.deepEqual(
    extractTemplateVariables("{{client_name}} and {{client_name}} {{dashboard_url}}"),
    ["client_name", "dashboard_url"],
  );
});
