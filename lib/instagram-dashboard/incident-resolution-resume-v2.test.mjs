import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260807132013_incident_resolution_resume_authorization_v2.sql", import.meta.url),
  "utf8",
);
const tick = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");

test("V2 authorization is account, incident, SHA, expiry and idempotency scoped", () => {
  for (const field of [
    "source_run_id", "source_request_id", "resolved_by", "resolved_at",
    "cause_fixed_version", "business_date", "expected_worker_sha", "expires_at",
    "idempotency_key", "created_at", "updated_at",
  ]) assert.match(migration, new RegExp(field));
  assert.match(migration, /incident-resume:' \|\| a\.account_id::text \|\| ':' \|\| a\.incident_id::text/);
  assert.match(migration, /incident_resume_authorizations_v2_idempotency_idx/);
  assert.match(migration, /when 'armed' then 'pending'/);
  assert.match(migration, /when 'revoked' then 'canceled'/);
});

test("V2 resolution synchronizes action and incident but forbids security incidents", () => {
  assert.match(migration, /transition_account_incident_human_review_v2/);
  assert.match(migration, /transition_account_incident_human_review_v1/);
  assert.match(migration, /dashboard_action_resolved/);
  assert.match(migration, /incident_resolved/);
  assert.match(migration, /incident_security_resolution_forbidden/);
  assert.match(migration, /severity = 'critical'/);
  assert.match(migration, /resume_authorization_created/);
  assert.match(migration, /next_tick_eligible/);
});

test("second resolution click reuses the incident authorization", () => {
  assert.match(migration, /v_incident\.status = 'resolved'/);
  assert.match(migration, /'idempotent', true/);
  assert.match(migration, /where a\.incident_id = p_incident_id/);
  assert.doesNotMatch(migration, /delete from public\.incident_resume_authorizations/i);
});

test("natural scheduler requires corrected active SHA and preserves one-shot consumption", () => {
  assert.match(tick, /reconcile_resolved_incident_resume_windows_v2/);
  assert.match(tick, /worker_heartbeats/);
  assert.match(tick, /resume_worker_sha_unavailable/);
  assert.match(tick, /resume_worker_sha_mismatch/);
  assert.match(tick, /expected_worker_sha: expectedWorkerSha/);
  assert.match(tick, /consumeAuthorizationAndCreateRequest/);
  assert.doesNotMatch(tick, /schedule-session.*delete|delete.*schedule-session/i);
});

test("V2 RPCs are service-role only", () => {
  assert.match(migration, /revoke all on function public\.transition_account_incident_human_review_v2[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.transition_account_incident_human_review_v2[\s\S]*to service_role/i);
  assert.match(migration, /revoke all on public\.incident_resume_authorizations_v2 from public, anon, authenticated/i);
});
