\set ON_ERROR_STOP on

\ir login-state-monotonic-v1.sql

alter table public.ig_accounts
  add column status text not null default 'active',
  add column admin_lifecycle_status text not null default 'active';
alter table public.account_assignments
  add column device_id uuid;
alter table public.phone_app_instances
  add column device_id uuid,
  add column status text not null default 'available',
  add column usable_for_auto_login boolean not null default true,
  add column is_launchable boolean not null default true;

create table public.phone_devices (
  id uuid primary key,
  status text not null
);
create table public.ig_targets (
  id uuid primary key,
  account_id uuid not null,
  status text,
  quality_status text,
  verification_status text,
  archived_at timestamptz,
  deleted_at timestamptz
);
create table public.account_dashboard_actions (
  id uuid primary key,
  account_id uuid not null,
  incident_id uuid,
  status text not null,
  blocking_campaign boolean not null default false
);
create table public.account_incidents (
  id uuid primary key,
  account_id uuid not null,
  archived_at timestamptz,
  lifecycle_version bigint not null default 1
);

create function public.transition_account_incident_human_review_v2(
  p_incident_id uuid,
  p_action text,
  p_expected_version bigint,
  p_actor_type text,
  p_actor_id uuid,
  p_source text,
  p_note text,
  p_resolution_reason text,
  p_idempotency_key text,
  p_expected_worker_sha text,
  p_cause_fixed_version text,
  p_channel text default null,
  p_notification_id uuid default null
)
returns jsonb language plpgsql
as $$
begin
  update public.account_dashboard_actions
  set status = 'resolved', blocking_campaign = false
  where incident_id = p_incident_id;
  return jsonb_build_object(
    'incident_resolved', p_action = 'resolve',
    'dashboard_action_resolved', true,
    'resume_authorization_created', true,
    'resume_authorization_id', 'a0000000-0000-4000-8000-000000000001'::uuid,
    'next_tick_eligible', true,
    'expected_worker_sha', p_expected_worker_sha,
    'cause_fixed_version', p_cause_fixed_version
  );
end;
$$;

create function public.account_package_runtime_contract_status(p_account_id uuid)
returns jsonb language sql stable
as $$ select jsonb_build_object('ok', true, 'reason', 'ready', 'account_id', p_account_id) $$;

insert into public.phone_devices values ('70000000-0000-4000-8000-000000000001', 'active');
update public.account_assignments
set device_id = '70000000-0000-4000-8000-000000000001'
where account_id = '10000000-0000-4000-8000-000000000003';
update public.phone_app_instances
set device_id = '70000000-0000-4000-8000-000000000001'
where id = '40000000-0000-4000-8000-000000000001';
insert into public.ig_targets values (
  '80000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'active', 'eligible', 'found', null, null
);
insert into public.account_incidents values (
  '81000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  null,
  1
);
insert into public.account_dashboard_actions values (
  '82000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000001',
  'pending',
  true
);

\ir ../migrations/20260810173000_operator_confirmed_login_readiness_v1.sql

set role service_role;
select public.confirm_instagram_login_operator_v1(
  '10000000-0000-4000-8000-000000000003',
  '90000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'operator-confirm:test-account',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'operator-confirmed-login-v1'
);
reset role;

do $$
declare
  v_verified_at timestamptz;
  v_result jsonb;
begin
  select login_identity_verified_at into v_verified_at
  from public.client_instagram_accounts
  where account_id = '10000000-0000-4000-8000-000000000003';

  if not exists (
    select 1 from public.client_instagram_accounts
    where account_id = '10000000-0000-4000-8000-000000000003'
      and login_status = 'connected'
      and provisioning_status = 'ready'
      and onboarding_status = 'ready'
      and login_identity_proof_status = 'verified'
      and login_identity_verification_source = 'operator'
      and login_identity_verification_method = 'manual_phone_review'
      and login_identity_verified_by = '90000000-0000-4000-8000-000000000001'
      and login_identity_verified_account_id = account_id
      and login_identity_verified_device_id = '70000000-0000-4000-8000-000000000001'
      and login_identity_verified_app_instance_id = '40000000-0000-4000-8000-000000000001'
      and login_identity_verified_assignment_id = '50000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'canonical operator proof was not persisted';
  end if;

  if exists (
    select 1 from public.account_dashboard_actions
    where incident_id = '81000000-0000-4000-8000-000000000001'
      and (status <> 'resolved' or blocking_campaign)
  ) then
    raise exception 'linked dashboard action was not atomically terminalized';
  end if;

  v_result := public.confirm_instagram_login_operator_v1(
    '10000000-0000-4000-8000-000000000003',
    '90000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    'operator-confirm:test-account',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'operator-confirmed-login-v1'
  );
  if coalesce((v_result ->> 'idempotent')::boolean, false) is not true
     or (select login_identity_verified_at from public.client_instagram_accounts where account_id = '10000000-0000-4000-8000-000000000003') is distinct from v_verified_at then
    raise exception 'double operator confirmation was not idempotent';
  end if;

  if has_function_privilege('anon', 'public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)', 'EXECUTE') then
    raise exception 'operator confirmation RPC grants are unsafe';
  end if;
end;
$$;

\ir ../rollback/20260810173000_operator_confirmed_login_readiness_v1.down.sql

do $$
begin
  if to_regprocedure('public.confirm_instagram_login_operator_v1(uuid,uuid,uuid,uuid,text,text,text)') is not null then
    raise exception 'rollback left operator confirmation RPC behind';
  end if;
end;
$$;

\ir ../migrations/20260810173000_operator_confirmed_login_readiness_v1.sql
\ir ../migrations/20260810173000_operator_confirmed_login_readiness_v1.sql

select 'operator_confirmed_login_readiness_v1_ok' as result;
