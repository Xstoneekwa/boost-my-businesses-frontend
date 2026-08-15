\set ON_ERROR_STOP on

create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key);
create or replace function auth.jwt()
returns jsonb language sql stable
as $$
  select jsonb_build_object('role', nullif(current_setting('request.jwt.claim.role', true), ''))
$$;
grant usage on schema auth to service_role;
grant execute on function auth.jwt() to service_role;

create table public.tenant_users (
  user_id uuid primary key references auth.users(id),
  role text not null
);
create table public.clients (id uuid primary key);
alter table public.clients add column status text not null default 'active';
create table public.ig_accounts (id uuid primary key, username text);
create table public.client_instagram_accounts (
  client_id uuid not null references public.clients(id),
  account_id uuid not null references public.ig_accounts(id),
  active boolean not null default true,
  primary key (client_id, account_id)
);
create table public.commercial_checkout_sessions (id uuid primary key);
create table public.client_account_entitlements (id uuid primary key);
create table public.commercial_stripe_billing_profiles (id uuid primary key);
create table public.commercial_stripe_subscriptions (id uuid primary key);
grant select, insert on table public.clients to service_role;
grant select, insert on table public.ig_accounts, public.client_instagram_accounts to service_role;

insert into auth.users (id) values
  ('580d7856-d60f-4838-a5f9-3b405d6ae79b'),
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');
insert into public.tenant_users (user_id, role) values
  ('580d7856-d60f-4838-a5f9-3b405d6ae79b', 'superadmin'),
  ('11111111-1111-4111-8111-111111111111', 'tenant'),
  ('22222222-2222-4222-8222-222222222222', 'superadmin'),
  ('33333333-3333-4333-8333-333333333333', 'superadmin'),
  ('44444444-4444-4444-8444-444444444444', 'admin');

\ir ../migrations/20260814210447_commercial_crm_foundation_v1.sql
\ir ../migrations/20260814211105_commercial_crm_foundation_v1_fk_indexes.sql
\ir ../migrations/20260814212322_commercial_dashboard_read_model_v1.sql
\ir ../migrations/20260814225656_commercial_lead_review_workflow_v1.sql
\ir ../migrations/20260815000234_commercial_discovery_enrichment_ai_scoring_v1.sql
\ir ../migrations/20260815003755_commercial_discovery_reliability_and_scale_gate_v1.sql
\ir ../migrations/20260815015500_commercial_discovery_run_metric_integrity_v1.sql
\ir ../migrations/20260815024608_commercial_shared_platform_identity_guard_v1.sql
\ir ../migrations/20260815031204_commercial_strong_identity_dedup_v1.sql
\ir ../migrations/20260815112508_commercial_outreach_orchestration_v1.sql

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'assertion_failed: %', p_message;
  end if;
end
$$;

create or replace function pg_temp.expect_error(p_sql text, p_fragment text, p_message text)
returns void language plpgsql as $$
declare
  v_caught boolean := false;
begin
  begin
    execute p_sql;
  exception when others then
    v_caught := true;
    if position(p_fragment in sqlerrm) = 0 then
      raise exception 'wrong_error: %, expected fragment %, got %', p_message, p_fragment, sqlerrm;
    end if;
  end;
  if not v_caught then
    raise exception 'expected_error_not_raised: %', p_message;
  end if;
end
$$;

select pg_temp.assert_true(
  (select count(*) = 7
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in (
       'internal_access_grants', 'commercial_campaigns', 'commercial_businesses',
       'commercial_contacts', 'commercial_leads', 'commercial_events', 'commercial_conversions'
     )
     and c.relrowsecurity and c.relforcerowsecurity),
  'all seven tables have enabled and forced RLS'
);

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.commercial_dashboard_read_model_v1(jsonb,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.commercial_dashboard_read_model_v1(jsonb,integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.commercial_dashboard_read_model_v1(jsonb,integer,integer)', 'EXECUTE'),
  'dashboard read RPC is service-role-only'
);

select pg_temp.assert_true(
  (select count(*) = 11
   from pg_indexes
   where schemaname = 'public'
     and indexname in (
       'commercial_internal_access_grants_granted_by_idx',
       'commercial_campaigns_created_by_idx',
       'commercial_campaigns_updated_by_idx',
       'commercial_leads_primary_contact_business_idx',
       'commercial_leads_approved_by_idx',
       'commercial_events_actor_auth_user_idx',
       'commercial_conversions_checkout_session_idx',
       'commercial_conversions_entitlement_idx',
       'commercial_conversions_stripe_billing_profile_idx',
       'commercial_conversions_stripe_subscription_idx',
       'commercial_conversions_converted_by_idx'
     )),
  'all eleven advisor FK indexes exist'
);

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'internal_access_grants', 'commercial_campaigns', 'commercial_businesses',
    'commercial_contacts', 'commercial_leads', 'commercial_events', 'commercial_conversions'
  ] loop
    perform pg_temp.assert_true(
      not has_table_privilege('anon', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE'),
      v_table || ' anon denied');
    perform pg_temp.assert_true(
      not has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT,INSERT,UPDATE,DELETE'),
      v_table || ' authenticated denied');
    perform pg_temp.assert_true(
      has_table_privilege('service_role', format('public.%I', v_table), 'SELECT'),
      v_table || ' service role read allowed');
  end loop;
end
$$;

set request.jwt.claim.role = 'service_role';
set role service_role;

insert into public.internal_access_grants (
  auth_user_id, permission_key, active, granted_by, revoked_at, metadata_safe
) values (
  '33333333-3333-4333-8333-333333333333', 'commercial_crm_access', false,
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', now(), '{"test":"revoked"}'::jsonb
);

select pg_temp.assert_true(
  public.commercial_crm_actor_authorized_v1('580d7856-d60f-4838-a5f9-3b405d6ae79b'),
  'canonical owner with active grant allowed');
select pg_temp.assert_true(
  not public.commercial_crm_actor_authorized_v1('11111111-1111-4111-8111-111111111111'),
  'tenant denied even without grant');
select pg_temp.assert_true(
  not public.commercial_crm_actor_authorized_v1('22222222-2222-4222-8222-222222222222'),
  'superadmin without grant denied');
select pg_temp.assert_true(
  not public.commercial_crm_actor_authorized_v1('33333333-3333-4333-8333-333333333333'),
  'revoked grant denied');
select pg_temp.assert_true(
  not public.commercial_crm_actor_authorized_v1('44444444-4444-4444-8444-444444444444'),
  'ordinary admin denied');

begin;

insert into public.clients (id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

insert into public.commercial_campaigns (
  id, campaign_code, name, country_code, city_scope, geography, vertical,
  status, created_by, updated_by
) values (
  'c0000000-0000-4000-8000-000000000001', 'SA_BEAUTY_LAUNCH_2026',
  'South Africa Beauty Launch 2026', 'SA', array['Cape Town', 'Johannesburg'],
  '{"market":"South Africa"}'::jsonb, 'beauty', 'active',
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', '580d7856-d60f-4838-a5f9-3b405d6ae79b'
);

insert into public.commercial_businesses (
  id, business_name, country_code, city, vertical, subsegment, website, instagram_handle
) values (
  'b0000000-0000-4000-8000-000000000001', 'Synthetic Beauty Studio', 'sa',
  'Cape Town', 'beauty', 'beauty_studio', 'https://www.Example-Beauty.test/book/', '@ExampleBeauty'
);

select pg_temp.assert_true(
  (select country_code = 'SA'
          and website_domain_normalized = 'example-beauty.test'
          and instagram_handle_normalized = 'examplebeauty'
   from public.commercial_businesses where id = 'b0000000-0000-4000-8000-000000000001'),
  'business identity normalization works'
);

insert into public.commercial_contacts (
  id, business_id, full_name, job_title, email, instagram_handle, phone,
  preferred_channel, is_primary
) values (
  'd0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001', 'Synthetic Owner', 'Founder',
  'OWNER@EXAMPLE-BEAUTY.TEST', '@SyntheticOwner', '+27 (00) 000-0000', 'instagram', true
);

insert into public.commercial_leads (
  id, campaign_id, business_id, primary_contact_id, qualification_status,
  score, priority, city_snapshot, subsegment_snapshot, outreach_channel,
  message_angle, template_version
) values (
  'e0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'qualified', 92, 'high', 'Cape Town', 'beauty_studio', 'instagram',
  'A', 'v1'
);

insert into public.commercial_events (
  lead_id, event_type, actor_type, actor_auth_user_id, idempotency_key, metadata_safe
) values (
  'e0000000-0000-4000-8000-000000000001', 'lead_created', 'commercial_owner',
  '580d7856-d60f-4838-a5f9-3b405d6ae79b', 'test-lead-created-1', '{"fixture":true}'::jsonb
);

select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'approve', 'test-approve-1'
);

with fixture_businesses as (
  insert into public.commercial_businesses (
    business_name, country_code, city, vertical, subsegment, instagram_handle, source, metadata_safe
  )
  select
    format('Synthetic Studio %s', n), 'SA',
    case when n % 2 = 0 then 'Johannesburg' else 'Cape Town' end,
    'beauty', case when n % 3 = 0 then 'Aesthetic Clinic' else 'Hair Salon' end,
    format('@SyntheticStudio%s', n), 'test_fixture', jsonb_build_object('fixture_n', n)
  from generate_series(2, 40) n
  returning id, (metadata_safe->>'fixture_n')::integer as n
)
insert into public.commercial_leads (
  campaign_id, business_id, qualification_status, score, priority,
  city_snapshot, subsegment_snapshot, outreach_channel, message_angle, template_version
)
select
  'c0000000-0000-4000-8000-000000000001', fb.id,
  case when fb.n <= 20 then 'qualified' else 'discovered' end,
  50 + fb.n,
  case when fb.n % 5 = 0 then 'high' else 'normal' end,
  case when fb.n % 2 = 0 then 'Johannesburg' else 'Cape Town' end,
  case when fb.n % 3 = 0 then 'Aesthetic Clinic' else 'Hair Salon' end,
  case when fb.n % 2 = 0 then 'email' else 'instagram' end,
  case when fb.n % 2 = 0 then 'B' else 'A' end,
  case when fb.n % 2 = 0 then 'EMAIL_BEAUTY_B_V1' else 'IG_BEAUTY_A_V1' end
from fixture_businesses fb;

select pg_temp.assert_true(
  (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,discovered}')::integer = 40,
  'dashboard counts all 40 deterministic fixture leads'
);
select pg_temp.assert_true(
  (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,qualified}')::integer = 20
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,contacted}')::integer = 0
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,replies}')::integer = 0
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,hot_leads}')::integer = 0
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,demos}')::integer = 0
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,paid}')::integer = 0,
  'pre-outreach KPI state is deterministic'
);
select pg_temp.assert_true(
  (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,paid_per_100_qualified}')::numeric = 0.0,
  'paid per 100 is zero before a canonical conversion'
);
select pg_temp.assert_true(
  jsonb_array_length(public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>'{queues,needs_approval}') = 8,
  'needs approval queue is real and bounded'
);
select pg_temp.assert_true(
  (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 2, 10)#>>'{leads,total}')::integer = 40
  and jsonb_array_length(public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 2, 10)#>'{leads,rows}') = 10,
  'lead table pagination is bounded and retains exact total'
);
select pg_temp.assert_true(
  (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z","search":"Synthetic Beauty Studio"}'::jsonb, 1, 25)#>>'{leads,total}')::integer = 1,
  'lead search filters business identity'
);
select pg_temp.assert_true(
  jsonb_array_length(public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>'{breakdowns,channel}') = 2
  and jsonb_array_length(public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>'{breakdowns,angle}') >= 2
  and jsonb_array_length(public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>'{breakdowns,city}') = 2
  and jsonb_array_length(public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>'{breakdowns,subsegment}') >= 2,
  'channel angle city and subsegment breakdowns are present'
);
select pg_temp.assert_true(
  (public.transition_commercial_lead_v1(
    '580d7856-d60f-4838-a5f9-3b405d6ae79b',
    'e0000000-0000-4000-8000-000000000001', 'approve', 'test-approve-1'
  ) ->> 'idempotent_replay')::boolean,
  'same approval request is idempotent'
);
select pg_temp.expect_error(
  $$select public.transition_commercial_lead_v1(
    '580d7856-d60f-4838-a5f9-3b405d6ae79b',
    'e0000000-0000-4000-8000-000000000001', 'approve', 'test-approve-duplicate'
  )$$,
  'commercial_lead_approve_invalid_transition', 'different duplicate approve rejected'
);

select pg_temp.expect_error(
  $$select public.transition_commercial_lead_v1(
    '11111111-1111-4111-8111-111111111111',
    'e0000000-0000-4000-8000-000000000001', 'queue_outreach', 'tenant-denied'
  )$$,
  'commercial_crm_owner_access_required', 'tenant RPC actor denied'
);
select pg_temp.expect_error(
  $$select public.transition_commercial_lead_v1(
    '22222222-2222-4222-8222-222222222222',
    'e0000000-0000-4000-8000-000000000001', 'queue_outreach', 'admin-denied'
  )$$,
  'commercial_crm_owner_access_required', 'superadmin without grant RPC actor denied'
);
select pg_temp.expect_error(
  $$select public.transition_commercial_lead_v1(
    '44444444-4444-4444-8444-444444444444',
    'e0000000-0000-4000-8000-000000000001', 'queue_outreach', 'botapp-denied'
  )$$,
  'commercial_crm_owner_access_required', 'BotApp-like actor RPC denied'
);

select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'queue_outreach', 'test-queue-1'
);
select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'mark_contacted', 'test-contacted-1'
);
select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'record_response', 'test-response-1'
);
select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'mark_sales_qualified', 'test-sales-qualified-1'
);
select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'mark_demo_booked', 'test-demo-booked-1'
);
select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'mark_demo_done', 'test-demo-done-1'
);
select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'mark_checkout_sent', 'test-checkout-sent-1'
);
select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000001', 'mark_paid', 'test-paid-1',
  '{"fixture":true}'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  null, null, null, null, 'instagram_automation_v1'
);

select pg_temp.assert_true(
  (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,contacted}')::integer = 1
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,replies}')::integer = 1
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,hot_leads}')::integer = 1
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,demos}')::integer = 1
  and (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,paid}')::integer = 1,
  'advanced funnel stages reflect canonical state transitions'
);
select pg_temp.assert_true(
  (public.commercial_dashboard_read_model_v1('{"date_from":"2000-01-01T00:00:00Z"}'::jsonb, 1, 25)#>>'{kpis,paid_per_100_qualified}')::numeric = 5.0,
  'paid customers per 100 qualified is exact at the minimum sample'
);

select pg_temp.assert_true(
  (select sales_status = 'paid' and version = 10
   from public.commercial_leads where id = 'e0000000-0000-4000-8000-000000000001'),
  'full valid pipeline reaches paid exactly once'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.commercial_conversions
   where lead_id = 'e0000000-0000-4000-8000-000000000001'),
  'paid transition creates exactly one conversion'
);
select pg_temp.assert_true(
  (select attribution_snapshot_safe ->> 'campaign_id' = 'c0000000-0000-4000-8000-000000000001'
          and attribution_snapshot_safe ->> 'message_angle' = 'A'
   from public.commercial_conversions
   where lead_id = 'e0000000-0000-4000-8000-000000000001'),
  'conversion freezes campaign and message attribution'
);
select pg_temp.assert_true(
  (select count(*) = 10 from public.commercial_events
   where lead_id = 'e0000000-0000-4000-8000-000000000001'),
  'every state transition has one event plus lead creation'
);
select pg_temp.assert_true(
  (public.transition_commercial_lead_v1(
    '580d7856-d60f-4838-a5f9-3b405d6ae79b',
    'e0000000-0000-4000-8000-000000000001', 'mark_paid', 'test-paid-1',
    '{"fixture":true}'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) ->> 'idempotent_replay')::boolean,
  'same paid request is idempotent'
);
select pg_temp.expect_error(
  $$select public.transition_commercial_lead_v1(
    '580d7856-d60f-4838-a5f9-3b405d6ae79b',
    'e0000000-0000-4000-8000-000000000001', 'mark_paid', 'test-paid-double',
    '{}'::jsonb, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )$$,
  'commercial_lead_paid_invalid_transition', 'different double paid rejected'
);

insert into public.commercial_businesses (
  id, business_name, country_code, city, vertical, instagram_handle
) values (
  'b0000000-0000-4000-8000-000000000002', 'Synthetic Reject Studio', 'SA',
  'Johannesburg', 'beauty', '@SyntheticRejectStudio'
);
insert into public.commercial_leads (
  id, campaign_id, business_id, qualification_status
) values (
  'e0000000-0000-4000-8000-000000000002',
  'c0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000002', 'enriched'
);
select pg_temp.expect_error(
  $$select public.transition_commercial_lead_v1(
    '580d7856-d60f-4838-a5f9-3b405d6ae79b',
    'e0000000-0000-4000-8000-000000000002', 'queue_outreach', 'invalid-queue'
  )$$,
  'commercial_lead_queue_invalid_transition', 'unapproved lead cannot queue'
);
select public.transition_commercial_lead_v1(
  '580d7856-d60f-4838-a5f9-3b405d6ae79b',
  'e0000000-0000-4000-8000-000000000002', 'reject', 'test-reject-1'
);
select pg_temp.assert_true(
  (select qualification_status = 'rejected' and outreach_status = 'stopped'
   from public.commercial_leads where id = 'e0000000-0000-4000-8000-000000000002'),
  'reject transition is coherent'
);

\ir commercial-lead-review-workflow-v1.sql
\ir commercial-discovery-enrichment-ai-scoring-v1.sql
\ir commercial-discovery-reliability-scale-v1.sql
\ir commercial-outreach-orchestration-v1.sql

reset role;
select pg_temp.expect_error(
  $$update public.commercial_events set metadata_safe = '{}'::jsonb
    where idempotency_key = 'test-lead-created-1'$$,
  'commercial_events_are_append_only', 'event ledger rejects UPDATE even for table owner'
);

rollback;

select pg_temp.assert_true(
  (select count(*) = 1 from public.commercial_campaigns where campaign_code = 'BMB_ZA_BEAUTY_V1')
  and (select count(*) = 0 from public.commercial_businesses)
  and (select count(*) = 0 from public.commercial_contacts)
  and (select count(*) = 0 from public.commercial_leads)
  and (select count(*) = 0 from public.commercial_events)
  and (select count(*) = 0 from public.commercial_conversions),
  'all Commercial CRM fixtures rolled back'
);

select 'COMMERCIAL_CRM_FOUNDATION_V1_SQL_CERTIFIED' as certification;
