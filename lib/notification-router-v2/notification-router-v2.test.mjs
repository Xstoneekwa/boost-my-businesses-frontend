import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/20260831195057_notification_router_v2.sql", import.meta.url), "utf8");
const resolutionContextMigration = readFileSync(new URL("../../supabase/migrations/20260901223000_incident_notification_resolution_context_v1.sql", import.meta.url), "utf8");
const settings = readFileSync(new URL("./settings.ts", import.meta.url), "utf8");
const crypto = readFileSync(new URL("./crypto.ts", import.meta.url), "utf8");
const testRoute = readFileSync(new URL("../../app/api/instagram-dashboard/notifications/v2/test/route.ts", import.meta.url), "utf8");
const settingsRoute = readFileSync(new URL("../../app/api/instagram-dashboard/notifications/v2/settings/route.ts", import.meta.url), "utf8");
const historyRoute = readFileSync(new URL("../../app/api/instagram-dashboard/notifications/v2/history/route.ts", import.meta.url), "utf8");
const cronRoute = readFileSync(new URL("../../app/api/cron/notification-router/route.ts", import.meta.url), "utf8");
const vercel = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");

test("schema has 20 independent destination settings and immutable idempotent events", () => {
  assert.match(migration, /category, environment, channel/);
  assert.match(migration, /unnest\(array\['incident','new_client','plan_change','auto_login','ct_lifecycle'\]\)/);
  assert.match(migration, /unnest\(array\['test','live'\]\)/);
  assert.match(migration, /unnest\(array\['slack','discord'\]\)/);
  assert.match(migration, /idempotency_key text not null unique/);
  assert.match(migration, /notification_business_event_immutable/);
  assert.match(migration, /unique \(event_id, destination_id\)/);
});

test("atomic claim and retry contract are machine enforced", () => {
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /status = 'processing'/);
  assert.match(migration, /interval '1 minute'/);
  assert.match(migration, /interval '5 minutes'/);
  assert.match(migration, /interval '30 minutes'/);
  assert.match(migration, /attempt_number >= 4 then 'dead_letter'/);
  assert.match(migration, /skip_notification_delivery_v2/);
  assert.match(migration, /revoke all on function public\.claim_notification_deliveries_v2[\s\S]*from public, anon, authenticated/);
});

test("V1 Incident configuration migrates without deleting legacy storage", () => {
  assert.match(migration, /from public\.incident_notification_channel_settings legacy/);
  assert.match(migration, /'incident', 'live'/);
  assert.match(migration, /legacy\.webhook_ciphertext/);
  assert.doesNotMatch(migration, /drop table[^;]*incident_notification_channel_settings/i);
});

test("webhooks are write-only and use dedicated versioned keys", () => {
  assert.match(crypto, /NOTIFICATION_ROUTER_ENCRYPTION_KEY_V2/);
  assert.doesNotMatch(crypto, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(settings, /CURRENT_NOTIFICATION_KEY_VERSION/);
  assert.doesNotMatch(testRoute, /webhookUrl[^\n]*jsonOk/);
  assert.match(migration, /revoke all on table public\.notification_destination_settings from public, anon, authenticated/);
});

test("synthetic tests do not create business events", () => {
  assert.match(testRoute, /business_event_created: false/);
  assert.doesNotMatch(testRoute, /emit_notification_business_event_v2/);
  assert.doesNotMatch(testRoute, /account_incidents/);
});

test("commercial producers are transactionally bound to terminal convergence", () => {
  assert.match(migration, /new\.status <> 'fulfilled'/);
  assert.match(migration, /checkout_session\.status <> 'checkout_paid'/);
  assert.match(migration, /entitlement\.status <> 'entitlement_consumed'/);
  assert.match(migration, /subscription\.id is null/);
  assert.match(migration, /plan_change_state', ''\) <> 'webhook_reconciled'/);
  assert.match(migration, /actual_stripe_reconciled_at is null/);
  assert.match(migration, /new\.login_status = 'connected'[\s\S]*new\.login_identity_proof_status = 'verified'[\s\S]*new\.login_identity_username_match is true/);
});

test("category precedence suppresses generic Incident for Auto Login ownership", () => {
  assert.match(migration, /Specific business categories own their incidents/);
  assert.match(migration, /then return new; end if;/);
});

test("operator APIs fail closed and never project webhook ciphertext", () => {
  assert.match(settingsRoute, /requireRelayOrAdmin/);
  assert.match(historyRoute, /requireRelayOrAdmin/);
  assert.match(testRoute, /requireRelayOrAdmin/);
  assert.doesNotMatch(historyRoute, /webhook_ciphertext|webhook_url/);
  assert.doesNotMatch(testRoute, /webhookUrl[^\n]*jsonOk/);
  assert.match(migration, /revoke all on function public\.rotate_notification_incident_ciphertexts_v2\(jsonb\) from public, anon, authenticated/);
});

test("Auto Login success requires terminal run/request proof and no active runtime", () => {
  assert.match(migration, /request\.status in \('pending','queued','claimed','starting','processing','running','in_progress','active','cancel_requested'\)/);
  assert.match(migration, /request\.requested_run_type = 'login_provisioning'/);
  assert.match(migration, /run\.status in \('completed','failed','stopped','canceled'\)/);
});

test("isolated asynchronous dispatcher is authenticated and scheduled without Worker coupling", () => {
  assert.match(cronRoute, /CRON_SECRET/);
  assert.match(cronRoute, /dispatchNotificationBatch\(20\)/);
  assert.match(vercel, /\/api\/cron\/notification-router/);
  assert.doesNotMatch(cronRoute, /account_run_requests|ig_runs|scheduler-runtime|follow/);
});

test("incident lifecycle emits one safe resolution event with note and canonical deep-link", () => {
  assert.match(resolutionContextMigration, /'incident\.resolved:'/);
  assert.match(resolutionContextMigration, /'resolutionNote'/);
  assert.match(resolutionContextMigration, /'resolvedAt'/);
  assert.match(resolutionContextMigration, /'operatorId'/);
  assert.match(resolutionContextMigration, /incidents\?incident_id=' \|\| new\.id::text/);
  assert.match(resolutionContextMigration, /notification_type', ''\) = 'incident_human_review_resolved'/);
  assert.match(resolutionContextMigration, /before insert on public\.account_incident_notifications/);
  assert.doesNotMatch(resolutionContextMigration, /'password'|'verification_code'|'raw_xml'/i);
});
