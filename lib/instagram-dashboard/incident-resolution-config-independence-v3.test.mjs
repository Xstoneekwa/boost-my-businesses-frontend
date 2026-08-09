import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260809180222_incident_resolution_config_independence_v3.sql",
    import.meta.url,
  ),
  "utf8",
);
const scheduleRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/settings/schedule/route.ts", import.meta.url),
  "utf8",
);

test("critical severity is not treated as a security classification", () => {
  assert.doesNotMatch(migration, /severity\s*=\s*'critical'/i);
  assert.match(migration, /left\(lower\(coalesce\([^)]*incident_type[^)]*\)\), 9\) = 'security_'/i);
  assert.match(migration, /metadata ->> 'security_incident'/i);
  assert.match(migration, /incident_security_resolution_forbidden/);
  assert.match(migration, /resume_security_incident_forbidden/);
});

test("resolve restores the matching recovery plan in the same transaction", () => {
  assert.match(migration, /update public\.account_session_resume_plans p/);
  assert.match(migration, /set restart_allowed = true/);
  assert.match(migration, /p\.account_id = v_incident\.account_id/);
  assert.match(migration, /p\.run_id = v_incident\.run_id/);
  assert.match(migration, /p\.resume_state = 'awaiting_human_resume_authorization'/);
  assert.match(migration, /restart_allowed_restored/);
});

test("resume arming is generic and remains service-role only", () => {
  assert.match(migration, /arm_incident_resolution_auto_resume_v1/);
  assert.doesNotMatch(migration, /new\.incident_type not in/i);
  assert.doesNotMatch(migration, /loriele|rex_gen|mythyl|j_automatise/i);
  assert.match(
    migration,
    /revoke all on function public\.transition_account_incident_human_review_v2[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.transition_account_incident_human_review_v2[\s\S]*to service_role/i,
  );
});

test("account scheduling is independent from incident lifecycle state", () => {
  assert.doesNotMatch(scheduleRoute, /reconcile_account_operational_projection_v1/);
  assert.doesNotMatch(scheduleRoute, /schedule_operational_projection_blocked/);
  assert.match(scheduleRoute, /findDeviceSlotConflict/);
  assert.match(scheduleRoute, /assignment_slot_conflict/);
  assert.match(scheduleRoute, /supabase\.rpc\("assign_account_slot"/);
});
