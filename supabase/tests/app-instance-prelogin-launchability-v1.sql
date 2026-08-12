\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

create table public.phone_devices (
  id uuid primary key,
  status text not null,
  retired_at timestamptz
);

create table public.phone_app_instances (
  id uuid primary key,
  device_id uuid not null references public.phone_devices(id),
  instance_type text not null,
  instance_index integer not null,
  visible_label text not null,
  package_name text,
  launch_activity text,
  is_launchable boolean not null default true,
  status text not null default 'unknown',
  current_account_id uuid,
  usable_for_auto_login boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_assignments (
  id uuid primary key,
  account_id uuid not null,
  device_id uuid not null,
  app_instance_id uuid,
  status text not null,
  released_at timestamptz
);

insert into public.phone_devices (id, status) values
  ('10000000-0000-4000-8000-000000000001', 'available'),
  ('10000000-0000-4000-8000-000000000002', 'maintenance');

insert into public.phone_app_instances (
  id, device_id, instance_type, instance_index, visible_label, package_name,
  launch_activity, is_launchable, status, current_account_id,
  usable_for_auto_login, metadata
) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'clone', 1, 'prelogin', 'com.instagram.one', '.Main', false, 'disabled', '30000000-0000-4000-8000-000000000001', false,
    '{"version_name":"372","version_code":1,"generation":"current","runtime_block_reason":"identity_required_unverified","runtime_blocked":true,"scheduler_dispatchable":false}'::jsonb),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'clone', 2, 'verified', 'com.instagram.two', '.Main', true, 'occupied', '30000000-0000-4000-8000-000000000002', true,
    '{"version_name":"372","version_code":1,"generation":"current","identity_verified":true}'::jsonb),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'clone', 3, 'mismatch', 'com.instagram.three', '.Main', false, 'disabled', '30000000-0000-4000-8000-000000000003', false,
    '{"version_name":"372","version_code":1,"generation":"current","runtime_block_reason":"identity_mismatch"}'::jsonb),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'clone', 4, 'missing', null, '.Main', false, 'disabled', '30000000-0000-4000-8000-000000000004', false,
    '{"version_name":"372","version_code":1,"generation":"current","runtime_block_reason":"package_missing"}'::jsonb),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', 'clone', 5, 'maintenance', 'com.instagram.five', '.Main', false, 'disabled', '30000000-0000-4000-8000-000000000005', false,
    '{"version_name":"372","version_code":1,"generation":"current","runtime_block_reason":"maintenance","maintenance":true}'::jsonb),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'clone', 6, 'legacy', 'com.instagram.six', '.Main', false, 'disabled', null, false,
    '{"version_name":"372","version_code":1,"generation":"legacy_pre_reprovision","runtime_block_reason":"identity_required_unverified","replaced_by_app_instance_id":"20000000-0000-4000-8000-000000000007"}'::jsonb),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'clone', 7, 'review', 'com.instagram.seven', '.Main', false, 'disabled', '30000000-0000-4000-8000-000000000007', false,
    '{"version_name":"372","version_code":1,"generation":"current","runtime_block_reason":"review_required"}'::jsonb),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'clone', 8, 'other-clone', 'com.instagram.eight', '.Main', true, 'occupied', '30000000-0000-4000-8000-000000000008', true,
    '{"version_name":"372","version_code":1,"generation":"current"}'::jsonb);

insert into public.account_assignments (id, account_id, device_id, app_instance_id, status) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'reserved'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'active'),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'reserved'),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000004', 'reserved'),
  ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000005', 'reserved'),
  ('40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000007', 'reserved'),
  ('40000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000008', 'reserved');

\ir ../migrations/20260812193216_app_instance_prelogin_launchability_v1.sql

do $$
begin
  if not exists (
    select 1 from public.phone_app_instances
    where id = '20000000-0000-4000-8000-000000000001'
      and status = 'occupied' and is_launchable and usable_for_auto_login
      and (metadata ->> 'login_provisioning_allowed')::boolean
      and not (metadata ->> 'business_runtime_allowed')::boolean
  ) then raise exception 'pre-login identity gate was not reconciled'; end if;

  if not exists (
    select 1 from public.phone_app_instances
    where id = '20000000-0000-4000-8000-000000000003'
      and status = 'occupied' and is_launchable and usable_for_auto_login
  ) then raise exception 'identity mismatch did not preserve recovery launchability'; end if;

  if not exists (
    select 1 from public.phone_app_instances
    where id = '20000000-0000-4000-8000-000000000007'
      and status = 'occupied' and is_launchable and usable_for_auto_login
  ) then raise exception 'review-required instance was not reconciled'; end if;

  if exists (
    select 1 from public.phone_app_instances
    where id in (
      '20000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000005',
      '20000000-0000-4000-8000-000000000006'
    ) and is_launchable
  ) then raise exception 'technical or legacy blocker became launchable'; end if;

  if not exists (
    select 1 from public.phone_app_instances
    where id = '20000000-0000-4000-8000-000000000008'
      and status = 'occupied' and is_launchable and usable_for_auto_login
      and not (metadata ? 'technical_launchability_reconciled')
  ) then raise exception 'unrelated clone was modified'; end if;
end;
$$;

do $$
begin
  begin
    update public.phone_app_instances
    set status = 'disabled', is_launchable = false, usable_for_auto_login = false
    where id = '20000000-0000-4000-8000-000000000001';
    raise exception 'identity-gated instance was disabled again';
  exception when check_violation then null;
  end;
end;
$$;

set role service_role;
select public.reconcile_login_provisioning_app_instance_launchability_v1(
  '20000000-0000-4000-8000-000000000001'
);
reset role;

do $$
begin
  if not has_function_privilege('service_role', 'public.reconcile_login_provisioning_app_instance_launchability_v1(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.reconcile_login_provisioning_app_instance_launchability_v1(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reconcile_login_provisioning_app_instance_launchability_v1(uuid)', 'EXECUTE')
  then raise exception 'RPC privilege contract failed'; end if;
end;
$$;

\ir ../rollback/20260812193216_app_instance_prelogin_launchability_v1.down.sql

select 'app_instance_prelogin_launchability_v1_ok' as result;
