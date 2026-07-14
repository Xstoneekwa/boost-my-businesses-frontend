import assert from "node:assert/strict";
import test from "node:test";
import { findReviewableOperatorAction } from "./incident-operator-review.ts";

const incident = { id: "incident-1", accountId: "account-1", runId: "run-1" };

test("matches a reviewable operator action by incident id first", () => {
  const row = findReviewableOperatorAction([
    { id: "wrong", account_id: "account-1", incident_id: "incident-2", action_type: "operator_review_required", status: "pending" },
    { id: "exact", account_id: "account-1", incident_id: "incident-1", action_type: "operator_review_required", status: "pending_verification" },
  ], incident);
  assert.equal(row?.id, "exact");
});

test("falls back to the same run and account without crossing accounts", () => {
  const row = findReviewableOperatorAction([
    { id: "other-account", account_id: "account-2", action_type: "operator_review_required", status: "pending", dedupe_key: "account:account-2:run:run-1:dashboard_action:operator_review_required" },
    { id: "same-run", account_id: "account-1", action_type: "operator_review_required", status: "acknowledged", metadata_safe: { run_id: "run-1" } },
  ], incident);
  assert.equal(row?.id, "same-run");
});

test("never returns terminal, unrelated, or account-only actions", () => {
  assert.equal(findReviewableOperatorAction([
    { id: "terminal", account_id: "account-1", incident_id: "incident-1", action_type: "operator_review_required", status: "resolved" },
    { id: "account-only", account_id: "account-1", action_type: "operator_review_required", status: "pending" },
  ], incident), null);
});
