export const DM_TEMPLATE_MESSAGE_MAX_CHARS = 900;

export function normalizeDmTemplateMessage(value: unknown) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[\t ]+|[\t ]+$/g, "");
}

export function dmTemplateLineCount(value: string) {
  if (!value) return 0;
  return value.split("\n").length;
}

export function dmTemplateLengthError(label: "Welcome" | "Outreach", value: string) {
  if (value.length <= DM_TEMPLATE_MESSAGE_MAX_CHARS) return "";
  return `${label} message is too long (${value.length}/${DM_TEMPLATE_MESSAGE_MAX_CHARS} characters).`;
}
