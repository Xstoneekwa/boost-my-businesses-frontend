import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260901104203_canonical_operational_blocker_v1.sql", import.meta.url),
  "utf8",
);
const coordinationMigration = readFileSync(
  new URL("../../supabase/migrations/20260901175903_incident_dashboard_action_effective_blocker_v1.sql", import.meta.url),
  "utf8",
);
const manage = readFileSync(new URL("../../app/instagram-dashboard/manage-data.ts", import.meta.url), "utf8");
const scheduler = readFileSync(new URL("./schedule-session-cron.ts", import.meta.url), "utf8");

function canonicalFunctionBody() {
  const start = migration.indexOf("create or replace function public.canonical_active_blocking_incidents_v1");
  const end = migration.indexOf("$function$;", start);
  assert.ok(start >= 0 && end > start);
  return migration.slice(start, end);
}

test("the canonical SQL primitive owns the exact active blocker predicate", () => {
  const body = canonicalFunctionBody();
  assert.match(body, /status in \('open', 'acknowledged'\)/);
  assert.match(body, /archived_at is null/);
  assert.match(body, /resolved_at is null/);
  assert.match(body, /severity in \('error', 'critical'\)/);
  for (const type of [
    "instagram_human_confirmation_required",
    "instagram_account_restriction",
    "active_instagram_account_mismatch",
    "assigned_instagram_package_unavailable",
    "account_login_required",
  ]) assert.match(body, new RegExp(`'${type}'`));
});

test("metadata and not_before enrich output without broadening the safety WHERE clause", () => {
  const body = canonicalFunctionBody();
  const whereStart = body.indexOf("where incident.status");
  const whereClause = body.slice(whereStart, body.indexOf("\n  )\n  select", whereStart));
  assert.doesNotMatch(whereClause, /blocking_campaign/);
  assert.equal((whereClause.match(/manual_incident_resolution_required/g) ?? []).length, 0);
  assert.equal((whereClause.match(/not_before/g) ?? []).length, 0);
});

test("resolved and archived gates are explicit and generic warning is not a severity blocker", () => {
  const body = canonicalFunctionBody();
  assert.match(body, /archived_at is null\s+and incident\.resolved_at is null/);
  assert.doesNotMatch(body, /severity in \([^)]*warning/);
});

test("generic critical and allowlisted warning semantics remain represented by the one OR contract", () => {
  const body = canonicalFunctionBody();
  assert.match(body, /severity in \('error', 'critical'\)\s+or incident\.incident_type in/);
});

test("all enqueue/admission consumers are surgically rebound and fail closed on lineage drift", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(migration, /pg_get_functiondef\(admission_signature\)/);
  assert.match(migration, /pg_get_functiondef\(recovery_signature\)/);
  assert.match(migration, /canonical_active_blocking_incidents_v1\(array\[v_account\.id\]\)/);
  assert.match(migration, /certified admission predicate not found/);
  assert.match(migration, /certified recovery predicate not found/);
  assert.match(migration, /admission predicate is not singular/);
  assert.match(migration, /recovery predicate is not singular/);
  assert.ok(
    migration.indexOf("certified recovery predicate not found")
      < migration.indexOf("execute patched_admission_definition"),
  );
  assert.doesNotMatch(migration, /create or replace function public\.admit_account_run_attempt_v1/);
  assert.doesNotMatch(migration, /create or replace function public\.certify_zero_work_and_enqueue_recovery_v1/);
});

test("Profiles and scheduler each consume the same batch loader", () => {
  assert.match(manage, /loadCanonicalOperationalBlockers\(supabase, accountIds\)/);
  assert.match(scheduler, /loadOperationalBlockers\(supabase, accountIds\)/);
  assert.doesNotMatch(manage, /from\("account_incidents"\)[\s\S]*?\.eq\("account_id"/);
});

test("growth readiness stays separate while scheduler eligibility incorporates the blocker", () => {
  assert.match(manage, /readiness: readinessProjection\.overall_readiness_status/);
  assert.match(manage, /const schedulerEligible = canonicalReady && !operationalBlocker/);
  assert.match(manage, /schedulerEligible,/);
  assert.match(manage, /operationalBlocker,/);
});

test("linked stale actions are excluded while standalone actions remain effective", () => {
  assert.match(coordinationMigration, /action\.incident_id is null\s+or exists/);
  assert.match(coordinationMigration, /linked_incident\.status in \('open', 'acknowledged'\)/);
  assert.match(coordinationMigration, /linked_incident\.resolved_at is null/);
  assert.match(coordinationMigration, /linked_incident\.archived_at is null/);
});

test("terminal incident lifecycle synchronizes only proven linked actions", () => {
  assert.match(coordinationMigration, /sync_terminal_incident_dashboard_actions_v1/);
  assert.match(coordinationMigration, /where action\.incident_id = new\.id/);
  assert.match(coordinationMigration, /blocking_campaign = false/);
  assert.match(coordinationMigration, /requires_client_action = false/);
  assert.doesNotMatch(coordinationMigration, /delete from public\.account_(?:incidents|dashboard_actions)/);
});

test("Profiles, scheduler and atomic admission share one effective blocker primitive", () => {
  assert.match(coordinationMigration, /canonical_active_operational_blockers_v1/);
  assert.match(coordinationMigration, /from public\.canonical_active_blocking_incidents_v1/);
  assert.match(coordinationMigration, /pg_get_functiondef\(admission_signature\)/);
  assert.match(coordinationMigration, /pg_get_functiondef\(recovery_signature\)/);
  assert.match(coordinationMigration, /admission lineage drift/);
  assert.match(coordinationMigration, /recovery lineage drift/);
});

test("active blocker precedence is deterministic and safety-first", () => {
  assert.match(coordinationMigration, /when 'critical' then 0 when 'error' then 1 else 2/);
  assert.match(coordinationMigration, /candidates\.source_rank/);
  assert.match(coordinationMigration, /candidates\.category_rank/);
  assert.match(coordinationMigration, /candidates\.source_id/);
});
