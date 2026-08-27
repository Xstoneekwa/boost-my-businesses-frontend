import assert from "node:assert/strict";
import test from "node:test";
import { projectCurrentPasswordUpdateActions } from "./password-update-operational-state.ts";

const accountId = "account-future";
const incidentId = "incident-future";
const requestId = "request-future";
const runId = "run-future";

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: incidentId,
    account_id: accountId,
    status: "open",
    run_id: runId,
    failure_reason: "instagram_credentials_rejected",
    metadata: {
      request_id: requestId,
      run_id: runId,
      phase: "submit_credentials",
      reason_code: "instagram_credentials_rejected",
    },
    created_at: "2026-08-27T01:00:00.000Z",
    ...overrides,
  };
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-future",
    incident_id: incidentId,
    account_id: accountId,
    action_type: "update_instagram_password",
    status: "pending",
    blocking_campaign: true,
    requires_client_action: true,
    metadata: {
      request_id: requestId,
      run_id: runId,
      phase: "submit_credentials",
      reason_code: "instagram_credentials_rejected",
    },
    created_at: "2026-08-27T01:00:01.000Z",
    ...overrides,
  };
}

test("projects one current password state only from the same authentic event chain", () => {
  const state = projectCurrentPasswordUpdateActions([action()], [incident()]).get(accountId);
  assert.deepEqual(state, {
    actionId: "action-future",
    incidentId,
    accountId,
    requestId,
    runId,
    reason: "instagram_credentials_rejected",
    action: "update_instagram_password",
    phase: "submit_credentials",
    status: "pending",
    label: "Mettre à jour le mot de passe",
    canSubmitCode: false,
    source: "same_event_wrong_password_v1",
    createdAt: "2026-08-27T01:00:01.000Z",
  });
});

test("historical terminal action and incident do not reactivate password state", () => {
  assert.equal(
    projectCurrentPasswordUpdateActions(
      [action({ status: "dismissed" })],
      [incident({ status: "resolved" })],
    ).size,
    0,
  );
});

test("unlinked or cross-run evidence fails closed", () => {
  assert.equal(projectCurrentPasswordUpdateActions([action({ incident_id: null })], [incident()]).size, 0);
  assert.equal(
    projectCurrentPasswordUpdateActions([action()], [incident({ run_id: "different-run" })]).size,
    0,
  );
  assert.equal(
    projectCurrentPasswordUpdateActions(
      [action()],
      [incident({ metadata: { request_id: "different-request", run_id: runId, phase: "submit_credentials", reason_code: "instagram_credentials_rejected" } })],
    ).size,
    0,
  );
});

test("verification, human confirmation, and unknown failures remain distinct", () => {
  const rows = [
    action({ id: "code", action_type: "enter_email_verification_code" }),
    action({ id: "human", action_type: "review_login_challenge", metadata: { reason_code: "instagram_human_confirmation_required" } }),
    action({ id: "unknown", metadata: { reason_code: "unclassified_auto_login_failure", phase: "submit_credentials", request_id: requestId, run_id: runId } }),
  ];
  assert.equal(projectCurrentPasswordUpdateActions(rows, [incident()]).size, 0);
});
