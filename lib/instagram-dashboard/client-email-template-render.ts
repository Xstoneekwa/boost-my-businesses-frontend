import {
  CLIENT_EMAIL_ALLOWED_VARIABLES,
  CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES,
  type ClientEmailAllowedVariable,
} from "./client-email-constants.ts";

const VARIABLE_PATTERN = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

export function extractTemplateVariables(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]?.trim().toLowerCase();
    if (name) found.add(name);
  }
  return [...found];
}

export function findUnknownTemplateVariables(text: string): string[] {
  const allowed = new Set<string>(CLIENT_EMAIL_ALLOWED_VARIABLES);
  return extractTemplateVariables(text).filter((name) => !allowed.has(name));
}

export function validateTemplateVariableUsage(subject: string, bodyText: string): string[] {
  const unknown = [
    ...findUnknownTemplateVariables(subject),
    ...findUnknownTemplateVariables(bodyText),
  ];
  return [...new Set(unknown)];
}

export function renderTemplateText(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(VARIABLE_PATTERN, (_match, rawName: string) => {
    const name = rawName.trim().toLowerCase();
    return values[name] ?? "";
  });
}

export function buildTemplatePreview(
  subject: string,
  bodyText: string,
  values: Record<string, string> = CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES,
) {
  return {
    subject: renderTemplateText(subject, values),
    bodyText: renderTemplateText(bodyText, values),
    bodyHtml: textToSafeHtml(renderTemplateText(bodyText, values)),
    sampleValues: values,
  };
}

export function textToSafeHtml(bodyText: string): string {
  const escaped = bodyText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replace(/\n/g, "<br />")}</p>`);

  return paragraphs.length > 0 ? paragraphs.join("\n") : "<p></p>";
}

export function listAllowedVariablesForCategory(): ClientEmailAllowedVariable[] {
  return [...CLIENT_EMAIL_ALLOWED_VARIABLES];
}
