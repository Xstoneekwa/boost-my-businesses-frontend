import { readString } from "./guards.ts";

export const EMAIL_CODE_ACTION = "enter_email_verification_code";

const LOGIN_CHALLENGE_CODE_ACTIONS = new Set([
  "complete_two_factor",
  "resolve_checkpoint",
  "review_login_challenge",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isCanonicalVerificationCodeAction(row: {
  action_type?: unknown;
  metadata?: unknown;
} | null | undefined) {
  const actionType = readString(row?.action_type).toLowerCase();
  if (actionType === EMAIL_CODE_ACTION) return true;
  if (!LOGIN_CHALLENGE_CODE_ACTIONS.has(actionType) || !isRecord(row?.metadata)) return false;

  const metadata = row.metadata;
  return readString(metadata.source).toLowerCase() === "login_dashboard_action_publisher"
    && readString(metadata.stage).toLowerCase() === "post_submit"
    && metadata.human_review_required === true;
}

export function isVerificationActionType(actionType: unknown) {
  const normalized = readString(actionType).toLowerCase();
  return normalized === EMAIL_CODE_ACTION || LOGIN_CHALLENGE_CODE_ACTIONS.has(normalized);
}
