import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("./20260727160438_instagram_restriction_preflight_auto_restart_v1.sql", import.meta.url), "utf8");

test("restriction preflight is zero-action, hold-bound, and service-role-only", () => {
  assert.match(sql, /instagram_restriction_preflight/);
  assert.match(sql, /restriction_preflight_only/);
  assert.match(sql, /status = 'verification_required'/);
  assert.match(sql, /incident_type <> 'instagram_account_restriction'/);
  assert.match(sql, /consume_resume_authorization_and_create_request_v2/);
  assert.match(sql, /service_role_required/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/);
});
