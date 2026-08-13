\set ON_ERROR_STOP on

-- Reconstruct the certified operator-login predecessor first, then extend its
-- compact fixture with the production columns consumed by this successor.
\ir operator-confirmed-login-readiness-v1.sql

alter table public.ig_accounts
  add column archived_at timestamptz,
  add column trashed_at timestamptz,
  add column updated_at timestamptz not null default now();
alter table public.account_credentials
  add column secret_ref text;
alter table public.phone_app_instances
  add column current_account_id uuid;
alter table public.account_assignments
  add column schedule_mode text not null default 'scheduled';
alter table public.account_dashboard_actions
  add column action_type text,
  add column requires_client_action boolean not null default false,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column resolved_at timestamptz,
  add column metadata_safe jsonb;
alter table public.account_incidents
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column resolved_at timestamptz,
  add column status text not null default 'open',
  add column severity text not null default 'warning',
  add column incident_type text,
  add column action_required text,
  add column legal_hold boolean not null default false,
  add column resolution_reason text,
  add column resolution_note text,
  add column metadata jsonb;

create table public.ig_account_settings (
  account_id uuid primary key,
  account_status text,
  current_run_status text,
  updated_at timestamptz not null default now()
);
create table public.instagram_account_restriction_holds (
  id uuid primary key,
  account_id uuid not null,
  status text not null
);
create table public.ig_action_logs (
  id bigint generated always as identity primary key,
  account_id uuid,
  run_id uuid,
  target_username text,
  action_type text,
  status text,
  message text,
  payload jsonb,
  created_at timestamptz not null default now()
);

update public.account_credentials
set secret_ref = 'vault://synthetic-active-secret'
where account_id = '10000000-0000-4000-8000-000000000003';
update public.phone_app_instances
set current_account_id = '10000000-0000-4000-8000-000000000003',
    status = 'active'
where id = '40000000-0000-4000-8000-000000000001';
insert into public.ig_account_settings values (
  '10000000-0000-4000-8000-000000000003', 'inactive', 'idle', now()
);
update public.ig_accounts
set status = 'inactive', admin_lifecycle_status = 'active'
where id = '10000000-0000-4000-8000-000000000003';

-- The predecessor fixture contains one eligible target. Add fourteen, proving
-- that exactly 15 eligible out of a larger total passes the canonical gate.
insert into public.ig_targets (
  id, account_id, status, quality_status, verification_status, archived_at, deleted_at
)
select gen_random_uuid(), '10000000-0000-4000-8000-000000000003',
       'active', 'eligible', 'found', null, null
from generate_series(1, 14);
insert into public.ig_targets values (
  gen_random_uuid(), '10000000-0000-4000-8000-000000000003',
  'archived', 'eligible', 'found', now(), null
);
insert into public.ig_targets values (
  gen_random_uuid(), '10000000-0000-4000-8000-000000000003',
  'active', 'ineligible', 'found', null, null
);
insert into public.ig_targets values (
  gen_random_uuid(), '10000000-0000-4000-8000-000000000003',
  'active', 'eligible', 'not_found', null, null
);

insert into public.account_incidents (
  id, account_id, incident_type, created_at, updated_at, status, severity, action_required, metadata
) values (
  '83000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'auto_login_failed', now() - interval '1 hour', now() - interval '1 hour',
  'open', 'warning', 'review_login', '{"blocking_campaign":true}'::jsonb
);
insert into public.account_dashboard_actions (
  id, account_id, incident_id, action_type, status, blocking_campaign,
  requires_client_action, created_at, updated_at, metadata_safe
) values (
  '84000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  '83000000-0000-4000-8000-000000000001',
  'operator_review_required', 'pending_verification', true, true,
  now() - interval '1 hour', now() - interval '1 hour', '{}'::jsonb
);

\ir ../migrations/20260813213000_post_connection_growth_readiness_reconciliation_v1.sql

do $$
declare
  v_result jsonb;
begin
  v_result := public.reconcile_connected_instagram_growth_readiness_v1(
    '10000000-0000-4000-8000-000000000003', 'migration_backfill'
  );
  if (v_result ->> 'ok')::boolean is not true
     or (v_result ->> 'eligible_targets')::integer <> 15
     or (v_result ->> 'required_eligible_targets')::integer <> 15 then
    raise exception 'exactly 15 eligible targets did not pass: %', v_result;
  end if;
  if not exists (
    select 1 from public.ig_accounts
    where id = '10000000-0000-4000-8000-000000000003' and status = 'active'
  ) or not exists (
    select 1 from public.ig_account_settings
    where account_id = '10000000-0000-4000-8000-000000000003'
      and account_status = 'active' and current_run_status = 'idle'
  ) then
    raise exception 'operational projection was not reconciled';
  end if;
  if exists (
    select 1 from public.account_incidents
    where id = '83000000-0000-4000-8000-000000000001' and status <> 'resolved'
  ) or exists (
    select 1 from public.account_dashboard_actions
    where id = '84000000-0000-4000-8000-000000000001' and status <> 'resolved'
  ) then
    raise exception 'older login-only blockers were not superseded';
  end if;
  if has_function_privilege('anon', 'public.reconcile_connected_instagram_growth_readiness_v1(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reconcile_connected_instagram_growth_readiness_v1(uuid,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.reconcile_connected_instagram_growth_readiness_v1(uuid,text)', 'EXECUTE') then
    raise exception 'reconciliation RPC grants are unsafe';
  end if;
end;
$$;

-- Reducing the eligible cohort to 14 must fail closed without changing targets.
update public.ig_targets
set quality_status = 'ineligible'
where id = (
  select id from public.ig_targets
  where account_id = '10000000-0000-4000-8000-000000000003'
    and status = 'active' and quality_status = 'eligible' and verification_status = 'found'
  order by id limit 1
);
do $$
declare v_result jsonb;
begin
  v_result := public.reconcile_connected_instagram_growth_readiness_v1(
    '10000000-0000-4000-8000-000000000003', 'migration_backfill'
  );
  if v_result ->> 'reason' <> 'insufficient_eligible_targets'
     or (v_result ->> 'eligible_targets')::integer <> 14 then
    raise exception '14 eligible targets did not fail closed: %', v_result;
  end if;
end;
$$;

select 'post_connection_growth_readiness_reconciliation_v1_ok' as result;
