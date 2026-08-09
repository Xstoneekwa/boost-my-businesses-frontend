import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260809144500_incident_overview_reviewed_open_v1.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");
const rollbackPath = path.join(
  process.cwd(),
  "supabase/rollback/20260809144500_incident_overview_reviewed_open_v1.down.sql",
);
const rollbackSql = fs.readFileSync(rollbackPath, "utf8");

test("review metadata projects acknowledged operator action as reviewed", () => {
  assert.match(sql, /a\.metadata\s*->>\s*'review_status'[\s\S]*=\s*'reviewed'/);
  assert.match(sql, /a\.metadata\s*->>\s*'operator_review_completed'[\s\S]*in\s*\('true',\s*'1',\s*'yes'\)/);
  assert.match(sql, /then\s+'reviewed'[\s\S]*else\s+a\.status/);
});

test("reviewed unresolved incidents remain Open and not Action Required", () => {
  assert.match(sql, /when 'action_required' then b\.status in \('open', 'acknowledged'\) and b\.action_required_derived/);
  assert.match(sql, /else b\.status in \('open', 'acknowledged'\) and not b\.action_required_derived/);
  assert.match(sql, /'operator_action_status', r\.operator_action_status/);
});

test("overview remains service-role only", () => {
  assert.match(sql, /security definer/);
  assert.match(sql, /revoke all on function[\s\S]*public, anon, authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
});

test("rollback restores only the historical overview function", () => {
  assert.doesNotMatch(rollbackSql, /\\ir\s+/);
  assert.match(rollbackSql, /create or replace function public\.get_account_incidents_overview_v1/);
  assert.doesNotMatch(rollbackSql, /create or replace function public\.run_incident_retention_cleanup_v1/);
  assert.doesNotMatch(rollbackSql, /review_status|operator_review_completed/);
  assert.match(rollbackSql, /grant execute on function[\s\S]*to service_role/);
});
