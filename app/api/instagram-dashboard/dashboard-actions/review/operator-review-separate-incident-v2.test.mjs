import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "app/api/instagram-dashboard/dashboard-actions/review/route.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260802000000_operator_review_separate_incident_v2.sql"), "utf8");

test("review acknowledges the action without resolving the linked incident", () => {
  assert.match(migration, /p_action_id,\s*'acknowledged'/s);
  assert.doesNotMatch(migration, /p_action_id,\s*'resolved'/s);
  assert.match(migration, /incident_resolution_separate', true/);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
});

test("route exposes redacted success and conflict reasons", () => {
  assert.match(route, /reason: "success"/);
  assert.match(route, /reason: "not_reviewable"/);
  assert.match(route, /reason: "incident_transition_conflict"/);
  assert.match(route, /reason: "backend_unavailable"/);
  assert.doesNotMatch(route, /jsonError\([^\n]*error\.message/);
});
