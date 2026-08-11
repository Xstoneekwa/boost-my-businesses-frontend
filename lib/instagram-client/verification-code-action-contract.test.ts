import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { projectClientConnectProgress } from "./connect-progress-projection.ts";
import { isCanonicalVerificationCodeAction } from "./verification-code-action-contract.ts";

const root = process.cwd();
const submitService = fs.readFileSync(
  path.join(root, "lib/instagram-dashboard/submit-verification-code-service.ts"),
  "utf8",
);
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260811023000_generic_login_verification_action_submit_v1.sql"),
  "utf8",
);

test("direct email verification action remains code-submittable", () => {
  assert.equal(isCanonicalVerificationCodeAction({ action_type: "enter_email_verification_code" }), true);
});

test("canonical post-submit review challenge is code-submittable", () => {
  assert.equal(isCanonicalVerificationCodeAction({
    action_type: "review_login_challenge",
    metadata: {
      source: "login_dashboard_action_publisher",
      stage: "post_submit",
      human_review_required: true,
      challenge_type: "unknown",
    },
  }), true);
});

test("arbitrary review actions remain fail-closed", () => {
  assert.equal(isCanonicalVerificationCodeAction({
    action_type: "review_login_challenge",
    metadata: { source: "manual_admin_action", human_review_required: true },
  }), false);
  assert.equal(isCanonicalVerificationCodeAction({
    action_type: "review_login_challenge",
    metadata: {
      source: "login_dashboard_action_publisher",
      stage: "post_submit",
      human_review_required: false,
    },
  }), false);
});

test("client projection offers code only when the server contract accepts the action", () => {
  const accepted = projectClientConnectProgress({
    accountId: "account-1",
    overallStatus: "action_required",
    loginStatus: "pending",
    provisioningStatus: "login_pending",
    actionRequired: {
      id: "action-1",
      action_type: "review_login_challenge",
      status: "pending",
      accepts_verification_code: true,
    },
  });
  const rejected = projectClientConnectProgress({
    accountId: "account-1",
    overallStatus: "action_required",
    loginStatus: "pending",
    provisioningStatus: "login_pending",
    actionRequired: {
      id: "action-2",
      action_type: "review_login_challenge",
      status: "pending",
      accepts_verification_code: false,
    },
  });

  assert.equal(accepted.action_required?.can_submit_code, true);
  assert.equal(rejected.action_required?.can_submit_code, false);
});

test("service resolves the action by id before applying the shared type contract", () => {
  assert.match(submitService, /assertActiveVerificationCodeAction/);
  assert.match(submitService, /isCanonicalVerificationCodeAction/);
  assert.doesNotMatch(submitService, /\.eq\("action_type", EMAIL_CODE_ACTION\)/);
});

test("database contract accepts only canonical publisher challenges and preserves least privilege", () => {
  assert.match(migration, /review_login_challenge/);
  assert.match(migration, /login_dashboard_action_publisher/);
  assert.match(migration, /human_review_required/);
  assert.match(migration, /action_type = 'enter_email_verification_code'/);
  assert.match(migration, /verification_source_action_type/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});
