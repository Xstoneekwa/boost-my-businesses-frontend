import { readString } from "./guards.ts";
import { isCanonicalVerificationPending } from "./connect-operation-state.ts";

const ACTION_REQUIRED_TYPES = new Set([
  "enter_email_verification_code",
  "complete_two_factor",
  "resolve_checkpoint",
  "review_login_challenge",
  "update_instagram_password",
  "review_account_mismatch",
]);
const ACTIVE_ACTION_STATUSES = new Set(["pending", "acknowledged", "pending_verification", "code_submitted", "open"]);
const ACTIVE_REQUEST_STATUSES = new Set(["queued", "claimed", "starting", "running"]);
const ACTIVE_RUN_STATUSES = new Set(["running", "queued", "pending", "in_progress", "active", "starting"]);

export const POST_CANCEL_LOGIN_STATUS = "unknown";
export const POST_CANCEL_PROVISIONING_STATUS = "not_started";
export const POST_CANCEL_ONBOARDING_STATUS = "credentials_submitted";

export function findActiveVerificationAction(actionRows: Record<string, unknown>[]) {
  return actionRows.find((row) => {
    const actionType = readString(row.action_type);
    const status = readString(row.status).toLowerCase();
    return ACTION_REQUIRED_TYPES.has(actionType) && ACTIVE_ACTION_STATUSES.has(status);
  }) ?? null;
}

function isActiveVerificationActionRow(action: Record<string, unknown> | null | undefined) {
  if (!action) return false;
  const actionType = readString(action.action_type);
  const status = readString(action.status).toLowerCase();
  return ACTION_REQUIRED_TYPES.has(actionType) && ACTIVE_ACTION_STATUSES.has(status);
}

export function evaluateConnectChallengeChainActive(input: {
  requestStatus?: string | null;
  runStatus?: string | null;
  activeAction?: Record<string, unknown> | null;
  resumeRequestStatus?: string | null;
}) {
  const requestStatus = readString(input.requestStatus).toLowerCase();
  const runStatus = readString(input.runStatus).toLowerCase();
  const resumeRequestStatus = readString(input.resumeRequestStatus).toLowerCase();

  if (ACTIVE_REQUEST_STATUSES.has(requestStatus)) return true;
  if (ACTIVE_RUN_STATUSES.has(runStatus)) return true;
  if (isActiveVerificationActionRow(input.activeAction ?? null)) return true;
  if (ACTIVE_REQUEST_STATUSES.has(resumeRequestStatus)) return true;
  return false;
}

export function isStaleConnectChallengeAccountStatus(input: {
  loginStatus?: string | null;
  provisioningStatus?: string | null;
}) {
  return isCanonicalVerificationPending(input);
}

export const CONNECT_CHALLENGE_ACTION_TYPES = [...ACTION_REQUIRED_TYPES];
export const CONNECT_CHALLENGE_ACTIVE_REQUEST_STATUSES = [...ACTIVE_REQUEST_STATUSES];
export const CONNECT_CHALLENGE_ACTIVE_RUN_STATUSES = [...ACTIVE_RUN_STATUSES];
