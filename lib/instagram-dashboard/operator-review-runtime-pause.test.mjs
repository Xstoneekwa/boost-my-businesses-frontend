import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260813223000_operator_review_runtime_pause_v1.sql", import.meta.url),
  "utf8",
);
const terminalPrecedenceMigration = readFileSync(
  new URL("../../supabase/migrations/20260813225934_operator_review_terminal_precedence_v2.sql", import.meta.url),
  "utf8",
);
const atomicResolutionMigration = readFileSync(
  new URL("../../supabase/migrations/20260813235858_incident_resolution_atomic_runtime_reactivation_v3.sql", import.meta.url),
  "utf8",
);
const profilesRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/profiles/route.ts", import.meta.url),
  "utf8",
);

test("blocking operator review atomically pauses the runtime projection", () => {
  assert.match(migration, /account_status = 'paused_manual_review'/);
  assert.match(migration, /current_run_status = 'idle'/);
  assert.match(migration, /account_dashboard_action_runtime_pause_v1/);
  assert.match(migration, /coalesce\(new\.blocking_campaign, false\) is false/);
});

test("pause reconciliation is generic and never auto-unpauses an unresolved incident", () => {
  assert.match(migration, /reconcile_operator_review_runtime_pauses_v1/);
  assert.match(migration, /i\.id = a\.incident_id/);
  assert.match(migration, /'auto_unpause', false/);
  assert.doesNotMatch(migration, /where\s+account_id\s*=\s*'dfe78a92/i);
});

test("legacy pause migration required an unavailable explicit Active transition", () => {
  assert.match(migration, /resume_explicit_active_required/);
  assert.match(migration, /lower\(coalesce\(s\.account_status, ''\)\) = 'active'/);
});

test("profiles API projects the runtime status separately from readiness", () => {
  assert.match(profilesRoute, /accountRuntimeStatus: readString\(settings\?\.account_status, "active"\)/);
});

test("migration does not depend on a nonexistent dashboard-action run_id", () => {
  assert.doesNotMatch(migration, /new\.run_id/);
});

test("event trigger ignores terminal incidents and terminal operator actions", () => {
  assert.match(terminalPrecedenceMigration, /i\.id = new\.incident_id/);
  assert.match(terminalPrecedenceMigration, /i\.account_id = new\.account_id/);
  assert.match(terminalPrecedenceMigration, /i\.status in \('open', 'acknowledged', 'investigating'\)/);
  assert.match(terminalPrecedenceMigration, /i\.resolved_at is null/);
  assert.match(terminalPrecedenceMigration, /i\.archived_at is null/);
  assert.match(terminalPrecedenceMigration, /new\.status not in \('pending', 'acknowledged', 'pending_verification', 'code_submitted'\)/);
});

test("terminal precedence remains generic", () => {
  assert.doesNotMatch(terminalPrecedenceMigration, /dfe78a92|loriele/i);
});

test("resolve atomically restores only the operator-review pause", () => {
  assert.match(atomicResolutionMigration, /restore_resolved_operator_review_runtime_v3/);
  assert.match(atomicResolutionMigration, /account_status = 'active'/);
  assert.match(atomicResolutionMigration, /lower\(coalesce\(account_status, ''\)\) = 'paused_manual_review'/);
  assert.match(atomicResolutionMigration, /runtime_status_not_operator_review_pause/);
  assert.doesNotMatch(atomicResolutionMigration, /set\s+schedule_mode|timeslot_start\s*=|timeslot_end\s*=/i);
});

test("resolve remains fail closed for security and concurrent blocking reviews", () => {
  assert.match(atomicResolutionMigration, /security_incident_forbidden/);
  assert.match(atomicResolutionMigration, /another_blocking_operator_review_exists/);
  assert.match(atomicResolutionMigration, /i\.status in \('open', 'acknowledged', 'investigating'\)/);
  assert.match(atomicResolutionMigration, /coalesce\(a\.blocking_campaign, false\)/);
});

test("resolved-action trigger is generic and side-effect bounded", () => {
  assert.match(atomicResolutionMigration, /account_dashboard_action_runtime_resume_v3/);
  assert.match(atomicResolutionMigration, /new\.status <> 'resolved'/);
  assert.match(atomicResolutionMigration, /schedule_changed', false/);
  assert.match(atomicResolutionMigration, /commercial_lifecycle_changed', false/);
  assert.match(atomicResolutionMigration, /run_created', false/);
  assert.match(atomicResolutionMigration, /tick_created', false/);
  assert.doesNotMatch(atomicResolutionMigration, /dfe78a92|loriele/i);
});

test("generic reconciliation repairs only stranded resolved review pauses", () => {
  assert.match(atomicResolutionMigration, /reconcile_resolved_operator_review_runtime_v3/);
  assert.match(atomicResolutionMigration, /lower\(coalesce\(s\.account_status, ''\)\) = 'paused_manual_review'/);
  assert.match(atomicResolutionMigration, /i\.status = 'resolved'/);
  assert.match(atomicResolutionMigration, /a\.status = 'resolved'/);
});
