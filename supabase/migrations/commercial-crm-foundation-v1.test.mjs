import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("./20260814210447_commercial_crm_foundation_v1.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../rollback/20260814210447_commercial_crm_foundation_v1.down.sql", import.meta.url),
  "utf8",
);
const fkIndexes = readFileSync(
  new URL("./20260814211105_commercial_crm_foundation_v1_fk_indexes.sql", import.meta.url),
  "utf8",
);

const tables = [
  "internal_access_grants",
  "commercial_campaigns",
  "commercial_businesses",
  "commercial_contacts",
  "commercial_leads",
  "commercial_events",
  "commercial_conversions",
];

test("the migration creates the complete additive Commercial CRM foundation", () => {
  for (const table of tables) {
    assert.match(migration, new RegExp(`create table public\\.${table}\\s*\\(`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, "i"));
  }
  assert.match(migration, /commercial_campaigns_campaign_business_unique|commercial_leads_campaign_business_unique/i);
  assert.match(migration, /commercial_events_lead_idempotency_unique/i);
  assert.match(migration, /commercial_conversions[\s\S]*lead_id uuid not null unique/i);
  assert.match(migration, /attribution_snapshot_safe jsonb not null/i);
});

test("browser users and generic admins receive no data or transition privileges", () => {
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /revoke all on function[\s\S]*transition_commercial_lead_v1[\s\S]*from public, anon, authenticated;/i);
  assert.match(migration, /grant execute on function public\.transition_commercial_lead_v1[\s\S]*to service_role;/i);
  assert.match(migration, /tu\.role::text = 'superadmin'/i);
  assert.match(migration, /permission_key = 'commercial_crm_access'[\s\S]*iag\.active[\s\S]*iag\.revoked_at is null/i);
  assert.match(migration, /commercial_crm_actor_authorized_v1[\s\S]*security definer[\s\S]*set search_path = ''/i);
});

test("the owner seed is DB-only and validates the canonical auth mapping", () => {
  assert.match(migration, /580d7856-d60f-4838-a5f9-3b405d6ae79b/i);
  assert.match(migration, /canonical_commercial_owner_identity_missing_or_not_superadmin/i);
  assert.match(migration, /on conflict \(auth_user_id, permission_key\) do update/i);
});

test("lead transitions are locked, idempotent, state-validated, and event-backed", () => {
  assert.match(migration, /for update;/i);
  assert.match(migration, /commercial_crm_transition_v1/i);
  assert.match(migration, /idempotent_replay/i);
  assert.match(migration, /commercial_lead_approve_invalid_transition/i);
  assert.match(migration, /commercial_lead_response_invalid_transition/i);
  assert.match(migration, /commercial_lead_paid_invalid_transition/i);
  assert.match(migration, /insert into public\.commercial_events/i);
  assert.match(migration, /insert into public\.commercial_conversions/i);
});

test("events and conversions are immutable through service ACLs", () => {
  assert.match(migration, /commercial_events_are_append_only/i);
  assert.match(migration, /grant select, insert on table public\.commercial_events to service_role/i);
  assert.match(migration, /grant select, insert on table public\.commercial_conversions to service_role/i);
  assert.doesNotMatch(migration, /grant[^;]*update[^;]*commercial_events/i);
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*commercial_(events|conversions)/i);
});

test("the migration does not alter tenant, restaurant, BotApp, Phone Farm, or Stripe tables", () => {
  assert.doesNotMatch(migration, /alter table public\.(clients|tenant_users|ig_|commercial_stripe|commercial_checkout|client_account_entitlements)/i);
  assert.doesNotMatch(migration, /restaurant|botapp|phone[_ ]?farm/i);
});

test("the rollback documents removal of every V1 object", () => {
  for (const table of tables) {
    assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`, "i"));
  }
  assert.match(rollback, /drop function if exists public\.transition_commercial_lead_v1/i);
});

test("the advisor forward-fix adds exactly the eleven missing FK indexes and mutates no data", () => {
  assert.equal((fkIndexes.match(/create index /gi) ?? []).length, 11);
  assert.doesNotMatch(fkIndexes, /\b(insert|update|delete|truncate|alter table|drop)\b/i);
});
