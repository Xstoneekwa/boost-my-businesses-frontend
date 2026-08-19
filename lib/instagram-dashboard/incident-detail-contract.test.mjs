import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const detailSource = readFileSync(new URL("./incident-detail.ts", import.meta.url), "utf8");
const deliverySource = readFileSync(new URL("./incident-lifecycle-notifications.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../supabase/migrations/20260724203042_incident_detail_human_review_v1.sql", import.meta.url), "utf8");
const detailRoute = readFileSync(new URL("../../app/api/instagram-dashboard/incidents/[incidentId]/route.ts", import.meta.url), "utf8");
const actionRoute = readFileSync(new URL("../../app/api/instagram-dashboard/incidents/action/route.ts", import.meta.url), "utf8");

test("detail route is relay/admin authenticated with distinct safe statuses", () => {
  assert.match(detailRoute, /requireRelayOrAdmin\(request, "Incident detail"\)/);
  assert.match(detailRoute, /INCIDENT_ID_INVALID/);
  assert.match(detailRoute, /INCIDENT_NOT_FOUND/);
  assert.match(detailRoute, /INCIDENT_DETAIL_QUERY_FAILED/);
  assert.match(detailRoute, /400/);
  assert.match(detailRoute, /404/);
  assert.match(detailRoute, /500/);
});

test("detail contract is versioned, tolerant and redacted", () => {
  assert.match(detailSource, /contractVersion: "incident_detail_v1"/);
  assert.match(detailSource, /input\.run \?/);
  assert.match(detailSource, /input\.request \?/);
  assert.match(detailSource, /input\.assignment \?/);
  assert.match(detailSource, /operatorReviewAction: activeOperatorAction \?/);
  assert.match(detailSource, /redactIncidentMetadata/);
  assert.doesNotMatch(detailSource, /webhook_ciphertext|response_body_preview|error_message[^_s]/);
  assert.doesNotMatch(detailSource, /select\("\*"\)/);
});

test("Slack and Discord have separate delivery histories", () => {
  assert.match(detailSource, /slack: byChannel\("slack"\)/);
  assert.match(detailSource, /discord: byChannel\("discord"\)/);
  assert.match(detailSource, /safeDeliveryError/);
  assert.doesNotMatch(detailSource, /deliveryKey:/);
});

test("human review RPC is private, audited, idempotent and version guarded", () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /unique \(incident_id, idempotency_key\)/i);
  assert.match(migration, /p_expected_version <> v_incident\.lifecycle_version/);
  assert.match(migration, /for update/);
  assert.match(migration, /account_incident_review_events/);
  assert.match(migration, /ig_action_logs/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /http_post|net\.http|webhook_ciphertext/);
});

test("lifecycle supports real schema states only", () => {
  assert.match(migration, /v_action not in \('acknowledge', 'add_note', 'resolve', 'retry_notification'\)/);
  assert.match(migration, /set status = 'acknowledged'/);
  assert.match(migration, /set status = 'resolved'/);
  assert.doesNotMatch(migration, /set status = 'investigating'/);
  assert.doesNotMatch(migration, /reopen/);
  assert.match(migration, /incident_version_conflict/);
});

test("resolution notification deduplication and retries are channel-specific and bounded", () => {
  assert.match(migration, /v_channel_row\.channel \|\| ':' \|\| p_incident_id::text \|\| ':human_review_resolved:' \|\| v_event_id::text/);
  assert.match(migration, /on conflict \(delivery_key\) do nothing/);
  assert.match(migration, /v_channel not in \('slack', 'discord'\)/);
  assert.match(migration, /v_delivery\.attempt_count >= 3/);
  assert.match(deliverySource, /Promise\.allSettled/);
  assert.match(actionRoute, /delivery_dispatch_failed_after_database_commit/);
});

test("action route requires operator, optimistic version and immediate reread", () => {
  assert.match(actionRoute, /INCIDENT_OPERATOR_REQUIRED/);
  assert.match(actionRoute, /expectedVersion/);
  assert.match(actionRoute, /idempotencyKey/);
  assert.match(actionRoute, /loadIncidentDetail\(incidentId\)/);
  assert.match(actionRoute, /INCIDENT_ACTION_CONFLICT/);
});

test("manual resolution V2 requires runtime proof and returns explicit recovery fields", () => {
  assert.match(actionRoute, /transition_account_incident_human_review_v3/);
  assert.match(actionRoute, /INCIDENT_RESOLUTION_RUNTIME_PROOF_REQUIRED/);
  assert.match(actionRoute, /expected_worker_sha/);
  assert.match(actionRoute, /cause_fixed_version/);
  assert.match(actionRoute, /incident_resolved/);
  assert.match(actionRoute, /dashboard_action_resolved/);
  assert.match(actionRoute, /resume_authorization_created/);
  assert.match(actionRoute, /next_tick_eligible/);
  assert.match(actionRoute, /blocked_reason/);
});

test("read-only detail path cannot mutate incidents or notifications", () => {
  assert.doesNotMatch(detailSource, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  assert.doesNotMatch(detailRoute, /POST|PATCH|DELETE|\.rpc\(/);
});
