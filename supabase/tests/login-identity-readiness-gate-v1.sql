\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.ig_accounts (
  id uuid primary key,
  username text not null
);

create table public.client_instagram_accounts (
  id uuid primary key,
  client_id uuid not null,
  account_id uuid not null unique references public.ig_accounts(id),
  label text,
  onboarding_status text not null,
  provisioning_status text not null,
  login_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  active boolean not null default true,
  onboarding_rollback_at timestamptz,
  onboarding_rollback_id uuid
);

create table public.account_credentials (
  account_id uuid not null,
  provider text not null,
  status text not null,
  reauth_required boolean not null default false,
  reauth_reason text,
  updated_at timestamptz not null default now()
);

create table public.phone_app_instances (
  id uuid primary key,
  package_name text
);

create table public.account_assignments (
  id uuid primary key,
  account_id uuid not null,
  app_instance_id uuid references public.phone_app_instances(id),
  released_at timestamptz,
  status text not null
);

create table public.ig_runs (
  id uuid primary key,
  account_id uuid not null,
  status text not null
);

create table public.account_run_requests (
  id uuid primary key,
  account_id uuid not null,
  requested_run_type text not null,
  status text not null,
  run_id uuid
);

create table public.auto_restart_device_locks (
  device_id uuid,
  account_id uuid,
  lease_expires_at timestamptz
);

create function public.sync_instagram_account_runtime_settings_after_provisioning(
  p_account_id uuid,
  p_actor_type text,
  p_reason text,
  p_metadata jsonb
) returns jsonb
language sql
as $$ select jsonb_build_object('ok', true, 'account_id', p_account_id) $$;

create function public.sync_account_dashboard_actions_from_status(
  p_account_id uuid,
  p_actor_type text,
  p_reason text,
  p_external_request_id text,
  p_metadata jsonb
) returns jsonb
language sql
as $$ select jsonb_build_object('synced', true, 'account_id', p_account_id) $$;

insert into public.ig_accounts (id, username) values
  ('10000000-0000-4000-8000-000000000001', 'historical_ready'),
  ('10000000-0000-4000-8000-000000000002', 'false_ready'),
  ('10000000-0000-4000-8000-000000000003', 'future_account');

insert into public.client_instagram_accounts (
  id, client_id, account_id, onboarding_status, provisioning_status, login_status
) values
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ready', 'ready', 'connected'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'ready', 'ready', 'connected'),
  ('20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'credentials_submitted', 'login_pending', 'pending');

insert into public.account_credentials (account_id, provider, status) values
  ('10000000-0000-4000-8000-000000000003', 'instagram', 'active');
insert into public.phone_app_instances (id, package_name) values
  ('40000000-0000-4000-8000-000000000001', 'com.instagram.android');
insert into public.account_assignments (id, account_id, app_instance_id, status) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'active');

\ir ../migrations/20260810111500_login_identity_readiness_gate_v1.sql

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.client_instagram_accounts
  where account_id in (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002'
    )
    and login_identity_proof_status = 'historical_model_missing'
    and login_status = 'connected'
    and provisioning_status = 'ready'
    and onboarding_status = 'ready';
  if v_count <> 2 then
    raise exception 'historical classification changed lifecycle or missed rows: %', v_count;
  end if;

  if (select login_identity_proof_status from public.client_instagram_accounts where account_id = '10000000-0000-4000-8000-000000000003') <> 'required_unverified' then
    raise exception 'future account did not retain required_unverified';
  end if;
end;
$$;

-- Real direct-role calls: both browser roles must be rejected at the function ACL.
\set ON_ERROR_STOP off
set role anon;
select public.evaluate_login_identity_gate_v1('10000000-0000-4000-8000-000000000001');
\if :ERROR
  \echo 'anon direct RPC denied as expected'
\else
  \quit 1
\endif
reset role;

set role authenticated;
select public.evaluate_login_identity_gate_v1('10000000-0000-4000-8000-000000000001');
\if :ERROR
  \echo 'authenticated direct RPC denied as expected'
\else
  \quit 1
\endif
reset role;
\set ON_ERROR_STOP on

set role service_role;
select public.evaluate_login_identity_gate_v1('10000000-0000-4000-8000-000000000001');
reset role;

do $$
begin
  begin
    update public.client_instagram_accounts
    set login_status = 'connected', provisioning_status = 'ready', onboarding_status = 'ready'
    where account_id = '10000000-0000-4000-8000-000000000003';
    raise exception 'unverified direct ready transition unexpectedly succeeded';
  exception
    when check_violation then
      if sqlerrm <> 'login_identity_not_verified' then
        raise;
      end if;
  end;
end;
$$;

set role service_role;
select public.update_client_instagram_account_status(
  p_account_id := '10000000-0000-4000-8000-000000000003',
  p_login_status := 'connected',
  p_provisioning_status := 'ready',
  p_onboarding_status := 'ready',
  p_actor_type := 'provisioner',
  p_reason := 'synthetic_exact_identity',
  p_metadata := jsonb_build_object(
    'run_id', '60000000-0000-4000-8000-000000000003',
    'expected_identity_verified', true,
    'identity_verification_status', 'verified',
    'profile_opened', true,
    'expected_username', 'future_account',
    'actual_logged_in_username', 'future_account'
  )
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.client_instagram_accounts
    where account_id = '10000000-0000-4000-8000-000000000003'
      and login_identity_proof_status = 'verified'
      and login_identity_profile_opened = true
      and login_identity_username_match = true
      and login_identity_verified_at is not null
      and login_status = 'connected'
      and provisioning_status = 'ready'
      and onboarding_status = 'ready'
  ) then
    raise exception 'verified status publication was not persisted atomically';
  end if;
end;
$$;

insert into public.ig_runs (id, account_id, status) values
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'completed');
insert into public.account_run_requests (id, account_id, requested_run_type, status, run_id) values
  ('70000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'login_provisioning', 'completed', '60000000-0000-4000-8000-000000000002');

set role service_role;
select public.reconcile_proven_false_ready_identity_v1(
  '10000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000002',
  '{"expected_username":"false_ready","actual_logged_in_username":"","expected_identity_verified":false,"profile_opened":false,"username_match":false,"failure_reason":"own_profile_username_not_found"}'::jsonb,
  true
);
select public.reconcile_proven_false_ready_identity_v1(
  '10000000-0000-4000-8000-000000000002',
  '60000000-0000-4000-8000-000000000002',
  '{"expected_username":"false_ready","actual_logged_in_username":"","expected_identity_verified":false,"profile_opened":false,"username_match":false,"failure_reason":"own_profile_username_not_found"}'::jsonb,
  false
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.client_instagram_accounts
    where account_id = '10000000-0000-4000-8000-000000000002'
      and login_status = 'verification_pending'
      and provisioning_status = 'login_verification_pending'
      and onboarding_status = 'credentials_submitted'
      and login_identity_proof_status = 'proven_false_ready'
  ) then
    raise exception 'proven false-ready reconciliation failed';
  end if;
end;
$$;

\ir ../rollback/20260810111500_login_identity_readiness_gate_v1.down.sql

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client_instagram_accounts'
      and column_name = 'login_identity_proof_status'
  ) then
    raise exception 'rollback left identity columns behind';
  end if;
end;
$$;

-- Forward after rollback and a second idempotent forward must both succeed.
\ir ../migrations/20260810111500_login_identity_readiness_gate_v1.sql
\ir ../migrations/20260810111500_login_identity_readiness_gate_v1.sql

do $$
begin
  if not has_function_privilege('service_role', 'public.evaluate_login_identity_gate_v1(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.evaluate_login_identity_gate_v1(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.evaluate_login_identity_gate_v1(uuid)', 'EXECUTE')
  then
    raise exception 'final function ACL contract failed';
  end if;
end;
$$;

select 'login_identity_readiness_gate_v1_ok' as result;
